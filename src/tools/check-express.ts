import { z } from "zod";
import { apiCall, ApiError } from "../api/client.js";
import { fehler, antwort } from "../warenkorb.js";

/**
 * Express-Preis anfragen, ohne etwas anzulegen.
 *
 * Der Preis kommt live von Uber Direct und gilt nur etwa 15 Minuten. Die KI
 * soll ihn dem Kunden nennen koennen, bevor sie mit express: true bestellt.
 */
export const checkExpressSchema = {
  address: z
    .string()
    .describe(
      "Vollständige Lieferadresse, z. B. 'Leopoldstraße 1, 80802 München'"
    ),
};

export async function checkExpress(args: { address: string }) {
  if (!args.address?.trim()) {
    return fehler("missing_parameter", "Bitte die Lieferadresse angeben.");
  }

  try {
    const quote = (await apiCall("/store/uber/quote", {
      params: { address: args.address.trim() },
    })) as {
      fee?: number;
      currency?: string;
      estimatedMinutes?: number;
      feeFormatted?: string;
    };

    if (!quote.fee) {
      return fehler(
        "express_nicht_verfuegbar",
        "Für diese Adresse ist gerade keine Express-Lieferung möglich.",
        {
          dem_kunden_sagen:
            "Express klappt für diese Adresse gerade nicht. Die normale Lieferung ist kostenlos und geht je nach Uhrzeit noch heute - das prüfe ich dir gern mit dem Wunschtermin.",
        }
      );
    }

    const euro = quote.fee / 100;
    return antwort({
      verfuegbar: true,
      adresse: args.address.trim(),
      zuschlag_eur: euro,
      zuschlag_formatiert: quote.feeFormatted ?? `${euro} €`,
      fahrzeit_minuten: quote.estimatedMinutes ?? null,
      gueltig_etwa: "15 Minuten",
      dem_kunden_sagen: `Express per Kurier kostet ${quote.feeFormatted ?? euro + " €"} zusätzlich${quote.estimatedMinutes ? ` und ist in etwa ${quote.estimatedMinutes} Minuten da` : ""}. Der Preis kommt live vom Kurierdienst und gilt rund 15 Minuten. Die normale Lieferung ist kostenlos.`,
      naechster_schritt:
        "Wenn der Kunde zustimmt, create_cart mit express: true aufrufen. Der Zuschlag erscheint dort als eigene Position.",
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return fehler(
        "express_nicht_verfuegbar",
        "Express-Lieferung ist aktuell nicht verfügbar.",
        {
          statusCode: error.statusCode,
          dem_kunden_sagen:
            "Express ist gerade nicht verfügbar. Die normale Lieferung ist kostenlos - sag mir einfach den Wunschtermin.",
        }
      );
    }
    throw error;
  }
}
