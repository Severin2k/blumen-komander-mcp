/**
 * Zentraler Katalog der Bestellangaben.
 *
 * Zweck: Die KI soll dem Kunden den kompletten Bestellablauf erklaeren
 * koennen, ohne dass der Kunde die Website aufruft - inklusive der Frage,
 * welche Angabe Pflicht ist, welche freiwillig, und was passiert, wenn eine
 * freiwillige Angabe fehlt.
 *
 * Wird von get_shop_info (Ablauf vorab) und create_cart (Status danach)
 * benutzt, damit beide nie auseinanderlaufen.
 */

export interface Bestellfeld {
  /** Parametername im Tool create_cart */
  feld: string;
  /** Wie der Kunde die Angabe nennt */
  bezeichnung: string;
  pflicht: boolean;
  /** Bei Pflicht: wofuer sie gebraucht wird. Bei optional: was ohne sie passiert. */
  hinweis: string;
}

export const BESTELLFELDER: Bestellfeld[] = [
  {
    feld: "variant_id",
    bezeichnung: "Gewaehlter Strauss",
    pflicht: true,
    hinweis: "Kommt aus search_flowers. Ohne Auswahl gibt es keinen Warenkorb.",
  },
  {
    feld: "quantity",
    bezeichnung: "Anzahl",
    pflicht: false,
    hinweis: "Ohne Angabe wird 1 Strauss bestellt.",
  },
  {
    feld: "delivery_date",
    bezeichnung: "Lieferdatum",
    pflicht: true,
    hinweis:
      "Wir liefern Montag bis Samstag. Vorher mit check_availability pruefen, ob der Tag moeglich ist.",
  },
  {
    feld: "first_name",
    bezeichnung: "Vorname des Empfaengers",
    pflicht: true,
    hinweis: "Steht auf der Lieferung und am Klingelschild-Abgleich.",
  },
  {
    feld: "last_name",
    bezeichnung: "Nachname des Empfaengers",
    pflicht: true,
    hinweis: "Der Fahrer sucht damit das Klingelschild.",
  },
  {
    feld: "address_1",
    bezeichnung: "Strasse und Hausnummer",
    pflicht: true,
    hinweis: "Lieferadresse. Stockwerk oder Firma bitte mit angeben.",
  },
  {
    feld: "postal_code",
    bezeichnung: "PLZ der Lieferadresse",
    pflicht: true,
    hinweis:
      "Muss im Liefergebiet liegen (Muenchen 80331-81929 sowie Neubiberg 85579).",
  },
  {
    feld: "city",
    bezeichnung: "Ort der Lieferadresse",
    pflicht: false,
    hinweis: "Ohne Angabe wird Muenchen eingetragen.",
  },
  {
    feld: "phone",
    bezeichnung: "Telefonnummer des Empfaengers",
    pflicht: false,
    hinweis:
      "Freiwillig, aber empfohlen: Ohne Nummer kann der Fahrer nicht anrufen, wenn niemand oeffnet.",
  },
  {
    feld: "email",
    bezeichnung: "E-Mail des Bestellers",
    pflicht: true,
    hinweis:
      "Dorthin gehen Bestellbestaetigung und Rechnung. Der Empfaenger sieht sie nicht.",
  },
  {
    feld: "greeting_card",
    bezeichnung: "Text fuer die Grusskarte",
    pflicht: false,
    hinweis:
      "Ohne Text wird der Strauss ohne Karte geliefert. Die Karte wird von Hand geschrieben, die Karte selbst kostet nichts.",
  },
  {
    feld: "payment_provider",
    bezeichnung: "Zahlungsart",
    pflicht: false,
    hinweis:
      "Ohne Angabe Kreditkarte/Apple Pay/Google Pay (stripe). Alternativen: paypal, sepa. Gezahlt wird erst auf der Checkout-Seite.",
  },
];

/** Die Rechnungsadresse ist eine Gruppe: entweder alle Felder oder keines. */
export const RECHNUNGSADRESSE_FELDER = [
  "billing_first_name",
  "billing_last_name",
  "billing_address_1",
  "billing_postal_code",
  "billing_city",
];

export const BESTELLABLAUF = [
  "1. Strauss aussuchen - search_flowers zeigt Sortiment, Preise und Bilder.",
  "2. Liefertermin pruefen - check_availability mit Datum und PLZ. Erst wenn das 'available: true' meldet, weiter.",
  "3. Angaben beim Kunden einsammeln - alle Pflichtangaben, die freiwilligen aktiv anbieten (Telefonnummer, Grusskartentext, abweichende Rechnungsadresse, Zahlungsart).",
  "4. Warenkorb anlegen - create_cart. Die Antwort sagt, welche Angaben fehlen und ob das schlimm ist.",
  "5. Checkout-Link an den Kunden - get_checkout_link. Auf der Seite zahlt der Kunde nur noch, es muss nichts mehr eingegeben werden.",
  "6. Nach der Zahlung kommt die Bestellbestaetigung per E-Mail mit Bestellnummer. Status danach jederzeit ueber get_order_status (Bestellnummer + E-Mail).",
];

export const CHECKOUT_HINWEIS =
  "Auf der Checkout-Seite muss der Kunde nur noch bezahlen. Adresse, Lieferdatum, Grusskarte und Zahlungsart sind bereits gesetzt. Solange nicht bezahlt wurde, ist die Bestellung nicht verbindlich und der Strauss nicht reserviert.";

export interface Feldstatus {
  vollstaendig: boolean;
  ausgefuellt: string[];
  offen: Bestellfeld[];
  rechnungsadresse: string;
  hinweis_fuer_kunden: string;
}

/**
 * Vergleicht die uebergebenen Argumente mit dem Katalog und sagt, was fehlt.
 * Pflichtfelder koennen hier praktisch nicht fehlen (das Schema erzwingt sie),
 * werden aber trotzdem geprueft, damit die Antwort nie luegt.
 */
export function feldstatus(args: Record<string, unknown>): Feldstatus {
  const gesetzt = (feld: string) => {
    const wert = args[feld];
    return wert !== undefined && wert !== null && String(wert).trim() !== "";
  };

  const ausgefuellt: string[] = [];
  const offen: Bestellfeld[] = [];
  for (const f of BESTELLFELDER) {
    if (gesetzt(f.feld)) ausgefuellt.push(f.bezeichnung);
    else offen.push(f);
  }

  const billingGesetzt = RECHNUNGSADRESSE_FELDER.some(gesetzt);
  const rechnungsadresse = billingGesetzt
    ? "eigene Rechnungsadresse angegeben"
    : "keine eigene angegeben - es gilt die Lieferadresse (freiwillig, kann abweichen)";
  if (billingGesetzt) ausgefuellt.push("Abweichende Rechnungsadresse");

  const fehlendePflicht = offen.filter((f) => f.pflicht);
  const fehlendeOptional = offen.filter((f) => !f.pflicht);

  const teile: string[] = [];
  if (fehlendePflicht.length) {
    teile.push(
      "Es fehlen noch Pflichtangaben: " +
        fehlendePflicht.map((f) => f.bezeichnung).join(", ") +
        ". Bitte beim Kunden nachfragen."
    );
  } else {
    teile.push("Alle Pflichtangaben liegen vor.");
  }
  if (fehlendeOptional.length) {
    teile.push(
      "Freiwillig und nicht angegeben: " +
        fehlendeOptional.map((f) => `${f.bezeichnung} (${f.hinweis})`).join(" ") +
        " Dem Kunden sagen, dass er das noch ergaenzen kann, aber nicht muss."
    );
  } else {
    teile.push("Auch alle freiwilligen Angaben sind gesetzt.");
  }
  if (!billingGesetzt) {
    teile.push(
      "Als Rechnungsadresse gilt die Lieferadresse. Wenn die Rechnung woanders hin soll, kann der Kunde das nennen."
    );
  }

  return {
    vollstaendig: fehlendePflicht.length === 0,
    ausgefuellt,
    offen,
    rechnungsadresse,
    hinweis_fuer_kunden: teile.join(" "),
  };
}
