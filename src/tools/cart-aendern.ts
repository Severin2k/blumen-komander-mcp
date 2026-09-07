import { z } from "zod";
import { apiCall, ApiError, PUBLIC_URL } from "../api/client.js";
import {
  istWunschstraussVariante,
  variantenPreis,
  warenkorbAufstellung,
  versandoptionWaehlen,
  fehler,
  antwort,
} from "../warenkorb.js";

/**
 * Warenkorb nachtraeglich aendern statt jedes Mal neu anzulegen.
 *
 * Bis 07.09.2026 gab es nur create_cart. Sagte der Kunde "doch lieber
 * Freitag" oder "leg noch eine Vase dazu", musste die KI alles neu anlegen -
 * der alte Warenkorb blieb als Leiche liegen, und Zubehoer war gar nicht
 * moeglich, weil create_cart genau einen Artikel kennt.
 */

// === add_to_cart ===

export const addToCartSchema = {
  cart_id: z.string().describe("ID des bestehenden Warenkorbs aus create_cart"),
  variant_id: z
    .string()
    .describe(
      "ID der Variante, die dazu soll - ein weiterer Strauß oder Zubehör wie Vase, Grußkarte, Pralinen, Ballon oder Prosecco aus der Liste zubehoer von search_flowers"
    ),
  quantity: z.number().optional().describe("Anzahl (Standard: 1)"),
  wunsch_text: z
    .string()
    .optional()
    .describe("Nur beim Wunschstrauß: Beschreibung, was gebunden werden soll"),
};

export async function addToCart(args: {
  cart_id: string;
  variant_id: string;
  quantity?: number;
  wunsch_text?: string;
}) {
  try {
    const istWunsch = await istWunschstraussVariante(args.variant_id);
    if (istWunsch && !args.wunsch_text?.trim()) {
      return fehler(
        "wunschtext_fehlt",
        "Für den Wunschstrauß fehlt die Beschreibung.",
        {
          dem_kunden_sagen:
            "Beim Wunschstrauß binden wir frei nach deiner Beschreibung. Sag mir bitte, was hinein soll - Blumenarten, Farben, Anlass, Stil.",
        }
      );
    }

    if (istWunsch) {
      const betrag = (await variantenPreis(args.variant_id)) ?? 20;
      await apiCall("/store/wunschstrauss/add", {
        method: "POST",
        body: {
          cart_id: args.cart_id,
          wunschtext: args.wunsch_text!.trim(),
          betrag,
        },
      });
    } else {
      await apiCall(`/store/carts/${args.cart_id}/line-items`, {
        method: "POST",
        body: { variant_id: args.variant_id, quantity: args.quantity || 1 },
      });
    }

    const aufstellung = await warenkorbAufstellung(args.cart_id);
    return antwort({
      cart_id: args.cart_id,
      positionen: aufstellung.positionen,
      gesamtpreis: aufstellung.gesamt,
      checkout_url: `${PUBLIC_URL}/de/checkout?cartId=${args.cart_id}&step=payment`,
      dem_kunden_sagen: `Hinzugefügt. Der Warenkorb kostet jetzt ${aufstellung.gesamt} EUR.`,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return fehler(error.type, error.message, {
        statusCode: error.statusCode,
        dem_kunden_sagen:
          "Der Artikel konnte nicht hinzugefügt werden. Möglicherweise ist der Warenkorb schon bezahlt oder abgelaufen.",
      });
    }
    throw error;
  }
}

// === update_cart ===

export const updateCartSchema = {
  cart_id: z.string().describe("ID des bestehenden Warenkorbs"),
  delivery_date: z
    .string()
    .optional()
    .describe("Neues Lieferdatum YYYY-MM-DD, bei Abholung das Abholdatum"),
  first_name: z.string().optional().describe("Vorname Empfänger"),
  last_name: z.string().optional().describe("Nachname Empfänger"),
  address_1: z.string().optional().describe("Straße und Hausnummer"),
  postal_code: z.string().optional().describe("PLZ"),
  city: z.string().optional().describe("Stadt"),
  phone: z.string().optional().describe("Telefonnummer Empfänger"),
  email: z.string().optional().describe("E-Mail des Bestellers"),
  greeting_card: z
    .string()
    .optional()
    .describe("Neuer Grußkartentext. Leerer Text entfernt die Karte."),
  pickup_time: z.string().optional().describe("Nur bei Abholung: Wunschuhrzeit"),
  payment_provider: z
    .enum(["stripe", "paypal", "sepa"])
    .optional()
    .describe("Andere Zahlungsart wählen"),
};

export async function updateCart(args: {
  cart_id: string;
  delivery_date?: string;
  first_name?: string;
  last_name?: string;
  address_1?: string;
  postal_code?: string;
  city?: string;
  phone?: string;
  email?: string;
  greeting_card?: string;
  pickup_time?: string;
  payment_provider?: string;
}) {
  try {
    const gelesen = (await apiCall(`/store/carts/${args.cart_id}`)) as {
      cart?: {
        completed_at?: string | null;
        metadata?: Record<string, unknown>;
        shipping_address?: Record<string, unknown>;
      };
    };
    const cart = gelesen.cart;
    if (!cart) {
      return fehler("not_found", "Warenkorb nicht gefunden.", {
        dem_kunden_sagen:
          "Der Warenkorb ist nicht mehr da. Ich lege einen neuen an.",
      });
    }
    if (cart.completed_at) {
      return fehler(
        "already_ordered",
        "Der Warenkorb ist bereits bezahlt und bestellt.",
        {
          dem_kunden_sagen:
            "Die Bestellung ist schon bezahlt und lässt sich hier nicht mehr ändern. Bitte im Laden anrufen unter +49 89 522634, dann schauen wir, was noch geht.",
        }
      );
    }

    const abholung = cart.metadata?.delivery_mode === "abholung";
    const alteAdresse = (cart.shipping_address || {}) as Record<string, string>;

    // Neues Datum oder neue PLZ: Liefergebiet und Termin erneut pruefen.
    const neuesDatum = args.delivery_date;
    const neuePlz = args.postal_code;
    if (!abholung && (neuesDatum || neuePlz)) {
      const datum =
        neuesDatum || (cart.metadata?.delivery_date as string) || undefined;
      const plz = neuePlz || alteAdresse.postal_code;
      if (datum && plz) {
        const v = (await apiCall("/store/availability", {
          params: { date: datum, postalCode: plz },
        })) as {
          available?: boolean;
          reason?: string;
          message?: string;
          earliest_delivery?: string;
        };
        if (v.available === false) {
          const ausserhalb = v.reason === "postalCode not in delivery area";
          return fehler(
            ausserhalb ? "outside_delivery_area" : "date_not_available",
            v.message || "Diese Änderung ist nicht möglich.",
            {
              earliest_delivery: v.earliest_delivery ?? null,
              dem_kunden_sagen: ausserhalb
                ? `Wir liefern leider nicht nach ${plz}. Der Warenkorb bleibt unverändert.`
                : `${v.message || "Der Wunschtermin ist nicht möglich."} Der Warenkorb bleibt unverändert.`,
            }
          );
        }
      }
    }

    if (abholung && neuesDatum) {
      const tag = new Date(`${neuesDatum}T12:00:00`).getDay();
      if (tag === 0) {
        return fehler(
          "abholung_sonntag",
          "Sonntags ist der Laden geschlossen.",
          {
            dem_kunden_sagen:
              "Sonntags haben wir geschlossen. Mo-Fr 08:00-18:30 Uhr, Sa 08:00-13:00 Uhr.",
          }
        );
      }
    }

    // Adresse nur anfassen, wenn wirklich etwas Neues kommt. Medusa ersetzt
    // die Adresse komplett, ein Teil-Update wuerde die uebrigen Felder leeren.
    const adressFelder = [
      "first_name",
      "last_name",
      "address_1",
      "postal_code",
      "city",
      "phone",
    ] as const;
    const adresseGeaendert = adressFelder.some(
      (f) => args[f] !== undefined && args[f] !== null
    );

    const body: Record<string, unknown> = {};
    if (args.email) body.email = args.email.toLowerCase();

    if (adresseGeaendert) {
      const neu: Record<string, string> = {
        first_name: args.first_name ?? alteAdresse.first_name ?? "",
        last_name: args.last_name ?? alteAdresse.last_name ?? "",
        address_1: args.address_1 ?? alteAdresse.address_1 ?? "",
        postal_code: args.postal_code ?? alteAdresse.postal_code ?? "",
        city: args.city ?? alteAdresse.city ?? (abholung ? "" : "München"),
        country_code: "de",
        phone: args.phone ?? alteAdresse.phone ?? "",
      };
      body.shipping_address = neu;
    }

    // Medusa fuehrt Metadata zusammen, es genuegt also, das Geaenderte zu
    // schicken. Ein leerer Grusskartentext entfernt die Karte bewusst.
    const metadata: Record<string, unknown> = {};
    if (neuesDatum) {
      if (abholung) metadata.pickup_date = neuesDatum;
      else metadata.delivery_date = neuesDatum;
    }
    if (args.pickup_time !== undefined) metadata.pickup_time = args.pickup_time;
    if (args.greeting_card !== undefined) {
      metadata.greeting_card = args.greeting_card.trim() || "";
    }
    if (Object.keys(metadata).length) body.metadata = metadata;

    if (Object.keys(body).length) {
      await apiCall(`/store/carts/${args.cart_id}`, {
        method: "POST",
        body,
      });
    }

    // Versandart kann durch eine neue Adresse verloren gehen.
    const nachher = (await apiCall(`/store/carts/${args.cart_id}`)) as {
      cart?: { shipping_methods?: unknown[] };
    };
    if (!nachher.cart?.shipping_methods?.length) {
      const versand = await versandoptionWaehlen(args.cart_id);
      if (versand.ok) {
        await apiCall(`/store/carts/${args.cart_id}/shipping-methods`, {
          method: "POST",
          body: { option_id: versand.id },
        });
      }
    }

    // Zahlungsart wechseln: neue Sitzung auf der bestehenden Sammlung.
    let zahlungHinweis: string | null = null;
    if (args.payment_provider) {
      const providerMap: Record<string, string> = {
        stripe: "pp_stripe_stripe",
        paypal: "pp_paypal_paypal",
        sepa: "pp_stripe_stripe",
      };
      try {
        const pcRes = (await apiCall("/store/payment-collections", {
          method: "POST",
          body: { cart_id: args.cart_id },
        })) as { payment_collection: { id: string } };
        await apiCall(
          `/store/payment-collections/${pcRes.payment_collection.id}/payment-sessions`,
          {
            method: "POST",
            body: {
              provider_id:
                providerMap[args.payment_provider] || "pp_stripe_stripe",
            },
          }
        );
      } catch {
        zahlungHinweis =
          "Die Zahlungsart konnte nicht umgestellt werden. Der Kunde kann sie im Checkout selbst wählen.";
      }
    }

    const aufstellung = await warenkorbAufstellung(args.cart_id);
    return antwort({
      cart_id: args.cart_id,
      geaendert: Object.keys(body).length
        ? Object.keys(body)
        : ["nichts - es wurde kein Feld übergeben"],
      liefermodus: abholung ? "Abholung im Laden" : "Lieferung",
      positionen: aufstellung.positionen,
      gesamtpreis: aufstellung.gesamt,
      checkout_url: `${PUBLIC_URL}/de/checkout?cartId=${args.cart_id}&step=payment`,
      ...(zahlungHinweis ? { hinweis: zahlungHinweis } : {}),
      dem_kunden_sagen: `Der Warenkorb ist angepasst, Gesamtpreis ${aufstellung.gesamt} EUR. Er ist erst verbindlich, wenn bezahlt wurde.`,
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
