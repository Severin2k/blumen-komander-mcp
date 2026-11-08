import {
  BESTELLFELDER,
  BESTELLABLAUF,
  CHECKOUT_HINWEIS,
} from "../bestellfelder.js";

export const getShopInfoSchema = {};

export async function getShopInfo() {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            name: "Blumen Komander",
            address: "Heßstraße 37, 80798 München",
            phone: "+49 89 522634",
            email: "info@blumen-komander.de",
            hours: "Mo-Fr 08:00-18:30, Sa 08:00-13:00",
            delivery_area:
              "München, PLZ 80331-81929, sowie Neubiberg (85579)",
            delivery_fee: "Kostenlose Lieferung in München",
            // Bis 08.11.2026 stand hier "Montag bis Samstag" - falsch, Sonntag
            // wird mit Zuschlag geliefert (siehe /store/availability).
            delivery_days:
              "Montag bis Sonntag. Sonntag per Kurier mit 15 EUR Sonntagszuschlag, Bestellung bis Samstag 12 Uhr. Keine Lieferung an bayerischen Feiertagen (ausser Valentinstag und Muttertag).",
            express:
              "Express in ca. 90 Minuten: Mo-Fr bis 17:00 Uhr, Sa bis 12:00 Uhr bestellbar, Zuschlag je nach Entfernung. Sonntags kein Express.",
            greeting_card:
              "Handschriftliche Karte: neutrale Karte kostenlos, Motivkarten 3,90 EUR.",
            anonym:
              "Anonym schicken moeglich: Namen einfach nicht auf die Grusskarte schreiben. Den Namen des Bestellers geben wir auch auf Nachfrage des Empfaengers nicht heraus.",
            outside_munich:
              "Ausserhalb des Liefergebiets nicht ueber den Shop bestellbar; auf Anfrage (Telefon/E-Mail) Vermittlung an Partner-Floristen vor Ort.",
            // Identisch mit Startseite, llms.txt und /store/availability.
            // Stand hier bis 06.09.2026 fest auf "12:00 Uhr" - das war der
            // Samstagswert und galt faelschlich fuer die ganze Woche.
            same_day_cutoff: "Mo-Fr bis 16:00 Uhr, Sa bis 12:00 Uhr",
            same_day_cutoff_hochlast:
              "Muttertag und Valentinstag bis 10:00 Uhr",
            payment_methods: [
              "Kreditkarte",
              "PayPal",
              "Apple Pay",
              "Google Pay",
              "SEPA Lastschrift",
            ],
            shop_url: "https://blumen-verschicken.online",
            api_docs: "https://blumen-verschicken.online/llms.txt",
            // Damit die KI dem Kunden den ganzen Ablauf erklaeren kann,
            // ohne dass er die Website aufruft.
            bestellablauf: BESTELLABLAUF,
            pflichtangaben: BESTELLFELDER.filter((f) => f.pflicht).map((f) => ({
              angabe: f.bezeichnung,
              feld: f.feld,
              hinweis: f.hinweis,
            })),
            freiwillige_angaben: BESTELLFELDER.filter((f) => !f.pflicht).map(
              (f) => ({
                angabe: f.bezeichnung,
                feld: f.feld,
                hinweis: f.hinweis,
              })
            ),
            rechnungsadresse:
              "Freiwillig. Ohne Angabe gilt die Lieferadresse als Rechnungsadresse.",
            checkout_hinweis: CHECKOUT_HINWEIS,
          },
          null,
          2
        ),
      },
    ],
  };
}
