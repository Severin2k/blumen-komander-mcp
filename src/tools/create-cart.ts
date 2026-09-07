import { z } from "zod";
import { apiCall, ApiError, PUBLIC_URL, REGION_ID } from "../api/client.js";
import { feldstatus, CHECKOUT_HINWEIS } from "../bestellfelder.js";
import {
  versandoptionWaehlen,
  istWunschstraussVariante,
  variantenPreis,
  warenkorbAufstellung,
  fehler,
  antwort,
} from "../warenkorb.js";

export const createCartSchema = {
  variant_id: z.string().describe("ID der gewählten Produktvariante"),
  quantity: z.number().optional().describe("Anzahl (Standard: 1)"),
  delivery_date: z
    .string()
    .describe("Lieferdatum YYYY-MM-DD, bei Abholung das Abholdatum"),
  first_name: z.string().describe("Vorname Empfänger"),
  last_name: z.string().describe("Nachname Empfänger"),
  address_1: z
    .string()
    .optional()
    .describe("Straße und Hausnummer - Pflicht bei Lieferung, entfällt bei Abholung"),
  postal_code: z
    .string()
    .optional()
    .describe("PLZ - Pflicht bei Lieferung, entfällt bei Abholung"),
  city: z.string().optional().describe("Stadt (Standard: München)"),
  phone: z.string().optional().describe("Telefonnummer Empfänger"),
  email: z.string().describe("E-Mail des Bestellers"),
  delivery_mode: z
    .enum(["lieferung", "abholung"])
    .optional()
    .describe(
      "lieferung (Standard) oder abholung im Laden, Heßstraße 37, 80798 München"
    ),
  pickup_time: z
    .string()
    .optional()
    .describe(
      "Nur bei Abholung: Wunschuhrzeit, z. B. '14:00'. Öffnungszeiten Mo-Fr 08:00-18:30, Sa 08:00-13:00."
    ),
  express: z
    .boolean()
    .optional()
    .describe(
      "true = Express-Lieferung per Kurier noch heute. Der Preis wird live bei Uber angefragt und als eigene Position berechnet. Vorher check_express aufrufen und dem Kunden den Preis nennen. Nicht mit Abholung kombinierbar."
    ),
  wunsch_text: z
    .string()
    .optional()
    .describe(
      "Nur beim Wunschstrauß: Beschreibung, was gebunden werden soll. Ohne diesen Text kann der Wunschstrauß nicht gebunden werden, er ist dort Pflicht."
    ),
  billing_first_name: z
    .string()
    .optional()
    .describe("Vorname Rechnungsadresse"),
  billing_last_name: z
    .string()
    .optional()
    .describe("Nachname Rechnungsadresse"),
  billing_address_1: z
    .string()
    .optional()
    .describe("Straße Rechnungsadresse"),
  billing_postal_code: z.string().optional().describe("PLZ Rechnungsadresse"),
  billing_city: z.string().optional().describe("Stadt Rechnungsadresse"),
  greeting_card: z.string().optional().describe("Text für die Grußkarte"),
  payment_provider: z
    .enum(["stripe", "paypal", "sepa"])
    .optional()
    .describe(
      "Zahlungsmethode: stripe (Kreditkarte, Apple Pay, Google Pay), paypal oder sepa (SEPA-Lastschrift). Standard: stripe."
    ),
};

type CreateCartArgs = {
  variant_id: string;
  quantity?: number;
  delivery_date: string;
  first_name: string;
  last_name: string;
  address_1?: string;
  postal_code?: string;
  city?: string;
  phone?: string;
  email: string;
  delivery_mode?: "lieferung" | "abholung";
  pickup_time?: string;
  express?: boolean;
  wunsch_text?: string;
  billing_first_name?: string;
  billing_last_name?: string;
  billing_address_1?: string;
  billing_postal_code?: string;
  billing_city?: string;
  greeting_card?: string;
  payment_provider?: string;
};

const LADENADRESSE = "Heßstraße 37, 80798 München";

export async function createCart(args: CreateCartArgs) {
  const abholung = args.delivery_mode === "abholung";

  try {
    // --- Schritt 0a: Angaben pruefen, die vom Liefermodus abhaengen ---
    if (!abholung && (!args.address_1 || !args.postal_code)) {
      const fehlend = [
        !args.address_1 ? "Straße und Hausnummer" : null,
        !args.postal_code ? "PLZ" : null,
      ].filter(Boolean);
      return fehler(
        "missing_delivery_address",
        `Für eine Lieferung fehlen noch: ${fehlend.join(" und ")}.`,
        {
          dem_kunden_sagen: `Für die Lieferung brauche ich noch ${fehlend.join(" und ")}. Alternativ kannst du den Strauß auch im Laden abholen, ${LADENADRESSE}.`,
        }
      );
    }

    if (abholung && args.express) {
      return fehler(
        "express_mit_abholung",
        "Express und Abholung schließen sich aus.",
        {
          dem_kunden_sagen:
            "Express ist eine Kurierlieferung. Wenn du selbst abholst, brauchst du sie nicht.",
        }
      );
    }

    // --- Schritt 0b: Termin pruefen, bevor irgendetwas angelegt wird ---
    // Bis 07.09.2026 fehlte das: check_availability meldete fuer 10115 Berlin
    // korrekt "liefern wir nicht in diese PLZ", create_cart legte fuer dieselbe
    // Adresse trotzdem einen zahlbaren Warenkorb an.
    if (abholung) {
      // Sonntags ist der Laden zu. Die Liefer-Verfuegbarkeit hilft hier nicht,
      // die kennt den Sonntagskurier.
      const tag = new Date(`${args.delivery_date}T12:00:00`).getDay();
      if (tag === 0) {
        return fehler(
          "abholung_sonntag",
          "Sonntags ist der Laden geschlossen.",
          {
            dem_kunden_sagen:
              "Sonntags haben wir geschlossen, da ist keine Abholung möglich. Unsere Zeiten: Mo-Fr 08:00-18:30 Uhr, Sa 08:00-13:00 Uhr.",
          }
        );
      }
    } else {
      const verfuegbarkeit = (await apiCall("/store/availability", {
        params: { date: args.delivery_date, postalCode: args.postal_code! },
      })) as {
        available?: boolean;
        reason?: string;
        message?: string;
        earliest_delivery?: string;
      };

      if (verfuegbarkeit.available === false) {
        const ausserhalb =
          verfuegbarkeit.reason === "postalCode not in delivery area";
        return fehler(
          ausserhalb ? "outside_delivery_area" : "date_not_available",
          verfuegbarkeit.message || "Diese Lieferung ist nicht möglich.",
          {
            postal_code: args.postal_code,
            delivery_date: args.delivery_date,
            earliest_delivery: verfuegbarkeit.earliest_delivery ?? null,
            dem_kunden_sagen: ausserhalb
              ? `Wir liefern leider nicht nach ${args.postal_code}. Unser Liefergebiet ist München (PLZ 80331-81929) sowie Neubiberg (85579). Abholen geht aber immer, ${LADENADRESSE}. Es wurde kein Warenkorb angelegt und nichts berechnet.`
              : `${verfuegbarkeit.message || "Der Wunschtermin ist nicht möglich."} Es wurde kein Warenkorb angelegt und nichts berechnet.`,
          }
        );
      }
    }

    // --- Schritt 0c: Wunschstrauss braucht zwingend eine Beschreibung ---
    const istWunsch = await istWunschstraussVariante(args.variant_id);
    if (istWunsch && !args.wunsch_text?.trim()) {
      return fehler(
        "wunschtext_fehlt",
        "Für den Wunschstrauß fehlt die Beschreibung.",
        {
          dem_kunden_sagen:
            "Beim Wunschstrauß binden wir frei nach deiner Beschreibung. Sag mir bitte, was hinein soll - Blumenarten, Farben, Anlass, Stil. Ohne das können wir ihn nicht binden.",
        }
      );
    }

    // --- Schritt 1: Warenkorb anlegen ---
    const cartRes = (await apiCall("/store/carts", {
      method: "POST",
      body: { region_id: REGION_ID },
    })) as { cart: { id: string } };
    const cartId = cartRes.cart.id;

    // --- Schritt 2: Artikel hinzufuegen ---
    if (istWunsch) {
      // Eigene Backend-Route, weil der Wunschtext und der freie Betrag ans
      // Line-Item muessen. Ein normales Line-Item kann beides nicht tragen.
      const betrag =
        (await variantenPreis(args.variant_id)) ?? 20;
      await apiCall("/store/wunschstrauss/add", {
        method: "POST",
        body: {
          cart_id: cartId,
          wunschtext: args.wunsch_text!.trim(),
          betrag,
        },
      });
    } else {
      await apiCall(`/store/carts/${cartId}/line-items`, {
        method: "POST",
        body: {
          variant_id: args.variant_id,
          quantity: args.quantity || 1,
        },
      });
    }

    // --- Schritt 3 und 4: Versandart gezielt waehlen und setzen ---
    const versand = await versandoptionWaehlen(cartId);
    if (!versand.ok) {
      return fehler(
        "no_shipping_option",
        "Die Münchner Lieferung ist gerade nicht als Versandart hinterlegt.",
        {
          cart_id: cartId,
          gefundene_optionen: versand.gefunden,
          dem_kunden_sagen: `Ich kann den Warenkorb technisch nicht abschließen. Bitte im Laden anrufen unter +49 89 522634 oder direkt auf ${PUBLIC_URL} bestellen.`,
        }
      );
    }
    await apiCall(`/store/carts/${cartId}/shipping-methods`, {
      method: "POST",
      body: { option_id: versand.id },
    });

    // --- Schritt 5: Adressen und Metadaten ---
    const shippingAddress = abholung
      ? {
          first_name: args.first_name,
          last_name: args.last_name,
          address_1: "",
          postal_code: "",
          city: "",
          country_code: "de",
          phone: args.phone || "",
        }
      : {
          first_name: args.first_name,
          last_name: args.last_name,
          address_1: args.address_1!,
          postal_code: args.postal_code!,
          city: args.city || "München",
          country_code: "de",
          phone: args.phone || "",
        };

    const billingAddress = args.billing_first_name
      ? {
          first_name: args.billing_first_name,
          last_name: args.billing_last_name,
          address_1: args.billing_address_1,
          postal_code: args.billing_postal_code,
          city: args.billing_city || "München",
          country_code: "de",
        }
      : shippingAddress;

    const metadata: Record<string, unknown> = abholung
      ? {
          delivery_mode: "abholung",
          pickup_date: args.delivery_date,
          ...(args.pickup_time ? { pickup_time: args.pickup_time } : {}),
        }
      : {
          delivery_date: args.delivery_date,
          delivery_mode: "lieferung",
        };
    if (args.greeting_card) {
      metadata.greeting_card = args.greeting_card;
    }

    await apiCall(`/store/carts/${cartId}`, {
      method: "POST",
      body: {
        email: args.email,
        shipping_address: shippingAddress,
        billing_address: billingAddress,
        metadata,
      },
    });

    // --- Schritt 5b: Express, falls gewuenscht ---
    // Den Zuschlag legt der Server-Subscriber cart-express-zuschlag an, sobald
    // shipping_type=express und uber_express_fee gesetzt sind. Bewusst NICHT
    // ueber /store/express/add, sonst entstehen zwei Zeilen (#244).
    let expressInfo: Record<string, unknown> | null = null;
    if (args.express && !abholung) {
      const adresse = `${args.address_1}, ${args.postal_code} ${args.city || "München"}`;
      try {
        const quote = (await apiCall("/store/uber/quote", {
          params: { address: adresse },
        })) as {
          fee?: number;
          estimatedMinutes?: number;
          feeFormatted?: string;
        };
        if (!quote.fee) throw new Error("keine Quote");

        await apiCall(`/store/carts/${cartId}`, {
          method: "POST",
          body: {
            metadata: {
              shipping_type: "express",
              express_abgelaufen: false,
              uber_express_address: adresse,
              uber_express_fee: quote.fee,
              uber_express_minutes: quote.estimatedMinutes ?? 0,
              uber_express_quoted_at: Date.now(),
            },
          },
        });
        expressInfo = {
          zuschlag_eur: quote.fee / 100,
          zuschlag_formatiert: quote.feeFormatted ?? `${quote.fee / 100} €`,
          fahrzeit_minuten: quote.estimatedMinutes ?? null,
          hinweis:
            "Der Express-Preis kommt live von Uber und gilt etwa 15 Minuten. Danach muss der Kunde im Checkout neu bepreisen. Dem Kunden den Zuschlag ausdrücklich nennen.",
        };
      } catch {
        expressInfo = {
          fehlgeschlagen: true,
          hinweis:
            "Express konnte nicht bepreist werden, der Warenkorb ist als normale Lieferung angelegt. Dem Kunden sagen, dass Express gerade nicht verfügbar ist.",
        };
      }
    }

    // --- Schritt 6: Zahlungssitzung ---
    const providerMap: Record<string, string> = {
      stripe: "pp_stripe_stripe",
      paypal: "pp_paypal_paypal",
      sepa: "pp_stripe_stripe",
    };
    const providerId =
      providerMap[(args.payment_provider as string) || "stripe"] ||
      "pp_stripe_stripe";

    const pcRes = (await apiCall("/store/payment-collections", {
      method: "POST",
      body: { cart_id: cartId },
    })) as { payment_collection: { id: string } };

    await apiCall(
      `/store/payment-collections/${pcRes.payment_collection.id}/payment-sessions`,
      {
        method: "POST",
        body: { provider_id: providerId },
      }
    );

    const checkoutUrl = `${PUBLIC_URL}/de/checkout?cartId=${cartId}&step=payment`;

    // Warenkorb zurueckklesen, statt die Summe zu raten. Das Backend haengt
    // Zuschlaege ueber Subscriber an (15 EUR Sonntagszuschlag, Express).
    // Die laufen asynchron, deshalb bei Express kurz nachfassen.
    let aufstellung = await warenkorbAufstellung(cartId);
    if (expressInfo && !expressInfo.fehlgeschlagen) {
      for (let versuch = 0; versuch < 3; versuch++) {
        if (
          aufstellung.positionen.some((p) =>
            p.bezeichnung.toLowerCase().includes("express")
          )
        ) {
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
        aufstellung = await warenkorbAufstellung(cartId);
      }
    }

    const status = feldstatus(args as unknown as Record<string, unknown>);

    return antwort({
      cart_id: cartId,
      checkout_url: checkoutUrl,
      summary: {
        liefermodus: abholung ? "Abholung im Laden" : "Lieferung",
        ...(abholung
          ? {
              abholung_am: args.delivery_date,
              abholung_zeit: args.pickup_time ?? null,
              abholadresse: LADENADRESSE,
            }
          : {
              delivery_date: args.delivery_date,
              address: `${args.address_1}, ${args.postal_code} ${args.city || "München"}`,
            }),
        recipient: `${args.first_name} ${args.last_name}`,
        greeting_card: args.greeting_card || null,
        ...(istWunsch ? { wunschstrauss_text: args.wunsch_text } : {}),
        email: args.email,
        delivery_fee: 0,
        payment_method: args.payment_provider || "stripe",
        positionen: aufstellung.positionen,
        gesamtpreis: aufstellung.gesamt,
        preis_hinweis:
          aufstellung.positionen.length > 1
            ? `Gesamtpreis ${aufstellung.gesamt} EUR inklusive aller Positionen. Die normale Lieferung ist kostenlos; Zuschläge wie Sonntag oder Express stehen als eigene Position. Dem Kunden den Gesamtpreis nennen, nicht nur den Straußpreis.`
            : `Gesamtpreis ${aufstellung.gesamt} EUR.${abholung ? " Abholung im Laden." : " Die Lieferung ist kostenlos."}`,
      },
      ...(expressInfo ? { express: expressInfo } : {}),
      angaben: {
        alle_pflichtangaben_vorhanden: status.vollstaendig,
        ausgefuellt: status.ausgefuellt,
        nicht_ausgefuellt: status.offen.map((f) => ({
          angabe: f.bezeichnung,
          feld: f.feld,
          pflicht: f.pflicht,
          hinweis: f.hinweis,
        })),
        rechnungsadresse: status.rechnungsadresse,
        dem_kunden_sagen: status.hinweis_fuer_kunden,
      },
      aendern_hinweis:
        "Solange nicht bezahlt wurde, kann der Warenkorb geändert werden: update_cart für Termin, Adresse, Grußkarte oder Zahlungsart, add_to_cart für einen weiteren Artikel.",
      naechster_schritt: status.vollstaendig
        ? "Checkout-Link an den Kunden geben. " + CHECKOUT_HINWEIS
        : "Erst die fehlenden Pflichtangaben beim Kunden erfragen.",
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return fehler(error.type, error.message, {
        statusCode: error.statusCode,
      });
    }
    throw error;
  }
}
