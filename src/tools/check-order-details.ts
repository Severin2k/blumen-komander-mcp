import { z } from "zod";
import {
  feldstatus,
  BESTELLABLAUF,
  CHECKOUT_HINWEIS,
} from "../bestellfelder.js";

/**
 * Trockenlauf vor create_cart: sagt, welche Angaben noch fehlen und ob sie
 * Pflicht sind. Legt bewusst nichts an und ruft das Backend nicht auf.
 *
 * Grund fuer dieses Tool: In create_cart sind die Pflichtfelder im Schema
 * erzwungen, ein fehlendes Feld erzeugt also einen technischen Zod-Fehler,
 * bevor der Code ueberhaupt laeuft. Hier ist alles optional, damit die KI
 * jederzeit mit einem Teilstand fragen kann "was fehlt noch?" und die Antwort
 * in Kundensprache bekommt.
 */
export const checkOrderDetailsSchema = {
  variant_id: z.string().optional().describe("ID der gewählten Produktvariante"),
  quantity: z.number().optional().describe("Anzahl"),
  delivery_date: z.string().optional().describe("Lieferdatum YYYY-MM-DD"),
  first_name: z.string().optional().describe("Vorname Empfänger"),
  last_name: z.string().optional().describe("Nachname Empfänger"),
  address_1: z.string().optional().describe("Straße und Hausnummer"),
  postal_code: z.string().optional().describe("PLZ"),
  city: z.string().optional().describe("Stadt"),
  phone: z.string().optional().describe("Telefonnummer Empfänger"),
  email: z.string().optional().describe("E-Mail des Bestellers"),
  billing_first_name: z.string().optional().describe("Vorname Rechnungsadresse"),
  billing_last_name: z.string().optional().describe("Nachname Rechnungsadresse"),
  billing_address_1: z.string().optional().describe("Straße Rechnungsadresse"),
  billing_postal_code: z.string().optional().describe("PLZ Rechnungsadresse"),
  billing_city: z.string().optional().describe("Stadt Rechnungsadresse"),
  greeting_card: z.string().optional().describe("Text für die Grußkarte"),
  payment_provider: z
    .enum(["stripe", "paypal", "sepa"])
    .optional()
    .describe("Zahlungsart"),
};

export async function checkOrderDetails(args: Record<string, unknown>) {
  const status = feldstatus(args || {});

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            alle_pflichtangaben_vorhanden: status.vollstaendig,
            ausgefuellt: status.ausgefuellt,
            fehlende_pflichtangaben: status.offen
              .filter((f) => f.pflicht)
              .map((f) => ({
                angabe: f.bezeichnung,
                feld: f.feld,
                hinweis: f.hinweis,
              })),
            fehlende_freiwillige_angaben: status.offen
              .filter((f) => !f.pflicht)
              .map((f) => ({
                angabe: f.bezeichnung,
                feld: f.feld,
                hinweis: f.hinweis,
              })),
            rechnungsadresse: status.rechnungsadresse,
            dem_kunden_sagen: status.hinweis_fuer_kunden,
            naechster_schritt: status.vollstaendig
              ? "Alles beisammen - jetzt create_cart aufrufen."
              : "Fehlende Pflichtangaben beim Kunden erfragen, dann create_cart.",
            bestellablauf: BESTELLABLAUF,
            checkout_hinweis: CHECKOUT_HINWEIS,
          },
          null,
          2
        ),
      },
    ],
  };
}
