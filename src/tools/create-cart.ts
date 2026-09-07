import { z } from "zod";
import { apiCall, ApiError, PUBLIC_URL, REGION_ID } from "../api/client.js";
import { feldstatus, CHECKOUT_HINWEIS } from "../bestellfelder.js";

export const createCartSchema = {
  variant_id: z.string().describe("ID der gewählten Produktvariante"),
  quantity: z.number().optional().describe("Anzahl (Standard: 1)"),
  delivery_date: z.string().describe("Lieferdatum YYYY-MM-DD"),
  first_name: z.string().describe("Vorname Empfänger"),
  last_name: z.string().describe("Nachname Empfänger"),
  address_1: z.string().describe("Straße und Hausnummer"),
  postal_code: z.string().describe("PLZ"),
  city: z.string().optional().describe("Stadt (Standard: München)"),
  phone: z.string().optional().describe("Telefonnummer Empfänger"),
  email: z.string().describe("E-Mail des Bestellers"),
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

export async function createCart(args: {
  variant_id: string;
  quantity?: number;
  delivery_date: string;
  first_name: string;
  last_name: string;
  address_1: string;
  postal_code: string;
  city?: string;
  phone?: string;
  email: string;
  billing_first_name?: string;
  billing_last_name?: string;
  billing_address_1?: string;
  billing_postal_code?: string;
  billing_city?: string;
  greeting_card?: string;
  payment_provider?: string;
}) {
  try {
    // Step 0: Liefergebiet und Datum pruefen, BEVOR ein Warenkorb entsteht.
    // Bis 07.09.2026 fehlte das: check_availability meldete fuer 10115 Berlin
    // korrekt "liefern wir nicht in diese PLZ", create_cart legte fuer dieselbe
    // Adresse trotzdem einen zahlbaren Warenkorb an. Die vorhandene Absicherung
    // ueber eine leere Versandoptionsliste greift nicht, weil Medusa immer alle
    // Optionen zurueckgibt (siehe Schritt 3).
    const verfuegbarkeit = (await apiCall("/store/availability", {
      params: { date: args.delivery_date, postalCode: args.postal_code },
    })) as {
      available?: boolean;
      reason?: string;
      message?: string;
      earliest_delivery?: string;
    };

    if (verfuegbarkeit.available === false) {
      const ausserhalb = verfuegbarkeit.reason === "postalCode not in delivery area";
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: true,
              type: ausserhalb ? "outside_delivery_area" : "date_not_available",
              message:
                verfuegbarkeit.message ||
                "Diese Lieferung ist nicht möglich.",
              postal_code: args.postal_code,
              delivery_date: args.delivery_date,
              earliest_delivery: verfuegbarkeit.earliest_delivery ?? null,
              dem_kunden_sagen: ausserhalb
                ? `Wir liefern leider nicht nach ${args.postal_code}. Unser Liefergebiet ist München (PLZ 80331-81929) sowie Neubiberg (85579). Es wurde kein Warenkorb angelegt und nichts berechnet.`
                : `${verfuegbarkeit.message || "Der Wunschtermin ist nicht möglich."} Es wurde kein Warenkorb angelegt und nichts berechnet.`,
            }),
          },
        ],
        isError: true,
      };
    }

    // Step 1: Create cart
    const cartRes = (await apiCall("/store/carts", {
      method: "POST",
      body: { region_id: REGION_ID },
    })) as { cart: { id: string } };
    const cartId = cartRes.cart.id;

    // Step 2: Add line item
    await apiCall(`/store/carts/${cartId}/line-items`, {
      method: "POST",
      body: {
        variant_id: args.variant_id,
        quantity: args.quantity || 1,
      },
    });

    // Step 3: Versandart gezielt waehlen.
    // Medusa gibt hier ALLE Optionen zurueck, ungefiltert nach PLZ und nach
    // Versandprofil. Belegt 07.09.2026: ein Warenkorb mit nur einer Flowerbox
    // (Profil "Default Shipping Profile") bekommt trotzdem auch
    // "Postversand (DHL)" aus dem Advent-Profil angeboten. Bis dahin nahm der
    // Code blind shipping_options[0]. Das war zufaellig richtig, haette aber
    // bei einer neuen Option oder geaenderter Reihenfolge stillschweigend
    // 10 EUR Porto auf eine Muenchner Lieferung gebucht.
    const shippingRes = (await apiCall("/store/shipping-options", {
      params: { cart_id: cartId },
    })) as {
      shipping_options?: Array<{
        id: string;
        name?: string;
        calculated_price?: { calculated_amount?: number };
      }>;
    };
    const optionen = shippingRes.shipping_options ?? [];

    const preisVon = (o: { calculated_price?: { calculated_amount?: number } }) =>
      o.calculated_price?.calculated_amount ?? null;

    // Erst ueber die bekannte ID, dann ueber den Namen, dann ueber "Muenchen
    // zum Nulltarif". Wird nichts davon gefunden, wird abgebrochen statt geraten.
    const MUENCHEN_OPTION_ID = "so_01KMZ8S0MDCTJSY1JC2K3MCV83";
    const MUENCHEN_OPTION_NAME = "Standardlieferung München";
    const gewaehlt =
      optionen.find((o) => o.id === MUENCHEN_OPTION_ID) ??
      optionen.find((o) => o.name === MUENCHEN_OPTION_NAME) ??
      optionen.find(
        (o) =>
          (o.name || "").toLowerCase().includes("münchen") && preisVon(o) === 0
      );

    if (!gewaehlt) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: true,
              type: "no_shipping_option",
              message:
                "Die Münchner Lieferung ist gerade nicht als Versandart hinterlegt. Bitte im Shop bestellen oder im Laden anrufen: +49 89 522634.",
              cart_id: cartId,
              gefundene_optionen: optionen.map((o) => o.name ?? o.id),
              dem_kunden_sagen:
                "Ich kann den Warenkorb technisch nicht abschließen. Bitte im Laden anrufen unter +49 89 522634 oder direkt auf blumen-verschicken.online bestellen.",
            }),
          },
        ],
        isError: true,
      };
    }

    const shippingOptionId = gewaehlt.id;

    // Step 4: Set shipping method
    await apiCall(`/store/carts/${cartId}/shipping-methods`, {
      method: "POST",
      body: { option_id: shippingOptionId },
    });

    // Step 5: Update cart with addresses and metadata
    const shippingAddress = {
      first_name: args.first_name,
      last_name: args.last_name,
      address_1: args.address_1,
      postal_code: args.postal_code,
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

    const metadata: Record<string, unknown> = {
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

    // Step 6: Initialize payment collection and session
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
    // ueber einen cart.updated-Subscriber automatisch Zuschlaege an, z. B.
    // 15 EUR Sonntagszuschlag. Bis 07.09.2026 meldete die Antwort stur
    // delivery_fee 0 und keine Summe - die KI haette dem Kunden 54,90 EUR
    // genannt, waehrend im Checkout 69,90 EUR standen.
    let positionen: Array<{ bezeichnung: string; preis: number | null }> = [];
    let gesamt: number | null = null;
    try {
      const cartRead = (await apiCall(`/store/carts/${cartId}`)) as {
        cart?: {
          total?: number;
          items?: Array<{ title?: string; unit_price?: number; quantity?: number }>;
        };
      };
      gesamt = cartRead.cart?.total ?? null;
      positionen =
        cartRead.cart?.items?.map((i) => ({
          bezeichnung:
            (i.quantity ?? 1) > 1
              ? `${i.quantity}x ${i.title ?? "Position"}`
              : i.title ?? "Position",
          preis: i.unit_price ?? null,
        })) ?? [];
    } catch {
      // Nicht kritisch: der Warenkorb steht, nur die Aufstellung fehlt dann.
    }

    // Was hat der Kunde angegeben, was fehlt noch und ist das Pflicht?
    // Die KI soll das dem Kunden weitergeben koennen, ohne die Seite zu kennen.
    const status = feldstatus(args as unknown as Record<string, unknown>);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              cart_id: cartId,
              checkout_url: checkoutUrl,
              summary: {
                delivery_date: args.delivery_date,
                recipient: `${args.first_name} ${args.last_name}`,
                address: `${args.address_1}, ${args.postal_code} ${args.city || "München"}`,
                greeting_card: args.greeting_card || null,
                email: args.email,
                delivery_fee: 0,
                payment_method: args.payment_provider || "stripe",
                positionen,
                gesamtpreis: gesamt,
                preis_hinweis:
                  positionen.length > 1
                    ? `Gesamtpreis ${gesamt} EUR inklusive aller Positionen. Die Lieferung selbst ist kostenlos; Zuschläge wie der Sonntagszuschlag stehen als eigene Position in der Aufstellung. Dem Kunden den Gesamtpreis nennen, nicht nur den Straußpreis.`
                    : `Gesamtpreis ${gesamt} EUR. Die Lieferung ist kostenlos.`,
              },
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
              naechster_schritt: status.vollstaendig
                ? "Checkout-Link an den Kunden geben. " + CHECKOUT_HINWEIS
                : "Erst die fehlenden Pflichtangaben beim Kunden erfragen.",
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error) {
    if (error instanceof ApiError) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: true,
              message: error.message,
              type: error.type,
              statusCode: error.statusCode,
            }),
          },
        ],
        isError: true,
      };
    }
    throw error;
  }
}
