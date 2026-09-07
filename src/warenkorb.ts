/**
 * Gemeinsame Warenkorb-Bausteine fuer create_cart, add_to_cart und
 * update_cart. Liegt hier, damit die drei Werkzeuge nicht auseinanderlaufen -
 * eine geaenderte Regel gilt sonst nur in einem davon.
 */
import { apiCall, REGION_ID } from "./api/client.js";

export const WUNSCHSTRAUSS_HANDLE = "wunschstrauss";

/** Die Muenchner Lieferung, gezielt statt shipping_options[0]. */
const MUENCHEN_OPTION_ID = "so_01KMZ8S0MDCTJSY1JC2K3MCV83";
const MUENCHEN_OPTION_NAME = "Standardlieferung München";

interface Versandoption {
  id: string;
  name?: string;
  calculated_price?: { calculated_amount?: number };
  service_zone?: { fulfillment_set?: { type?: string } };
}

/**
 * Medusa gibt unter /store/shipping-options ALLE Optionen zurueck, ungefiltert
 * nach PLZ und nach Versandprofil. Belegt 07.09.2026: ein Warenkorb mit nur
 * einer Flowerbox bekommt auch "Postversand (DHL)" aus dem Advent-Profil
 * angeboten. Deshalb wird gezielt gesucht statt [0] genommen.
 *
 * Fuer Abholung sucht der Shop eine Option aus einem pickup-Fulfillment-Set.
 * Ein solches Set gibt es hier nicht, deshalb faellt auch die Abholung auf die
 * Muenchner Option zu 0 EUR zurueck - genau wie im Checkout der Website.
 */
export async function versandoptionWaehlen(
  cartId: string
): Promise<
  | { ok: true; id: string; name: string }
  | { ok: false; gefunden: string[] }
> {
  const res = (await apiCall("/store/shipping-options", {
    params: { cart_id: cartId },
  })) as { shipping_options?: Versandoption[] };
  const optionen = res.shipping_options ?? [];

  const preis = (o: Versandoption) =>
    o.calculated_price?.calculated_amount ?? null;

  const gewaehlt =
    optionen.find((o) => o.id === MUENCHEN_OPTION_ID) ??
    optionen.find((o) => o.name === MUENCHEN_OPTION_NAME) ??
    optionen.find(
      (o) => (o.name || "").toLowerCase().includes("münchen") && preis(o) === 0
    );

  if (!gewaehlt) {
    return { ok: false, gefunden: optionen.map((o) => o.name ?? o.id) };
  }
  return { ok: true, id: gewaehlt.id, name: gewaehlt.name ?? gewaehlt.id };
}

/** Variant-IDs des Wunschstrauss-Produkts, einmal geladen und gemerkt. */
let wunschVarianten: Set<string> | null = null;
let wunschGeladen = 0;

export async function istWunschstraussVariante(
  variantId: string
): Promise<boolean> {
  const jetzt = Date.now();
  if (!wunschVarianten || jetzt - wunschGeladen > 10 * 60 * 1000) {
    try {
      const res = (await apiCall("/store/products", {
        params: {
          handle: WUNSCHSTRAUSS_HANDLE,
          fields: "id,handle,*variants",
          limit: "1",
          region_id: REGION_ID,
        },
      })) as {
        products?: Array<{ variants?: Array<{ id: string }> }>;
      };
      wunschVarianten = new Set(
        (res.products?.[0]?.variants ?? []).map((v) => v.id)
      );
      wunschGeladen = jetzt;
    } catch {
      // Lieber keine Erkennung als ein Abbruch der Bestellung.
      return false;
    }
  }
  return wunschVarianten.has(variantId);
}

/** Preis einer Variante, fuer den Wunschstrauss-Betrag. */
export async function variantenPreis(
  variantId: string
): Promise<number | null> {
  try {
    // region_id ist hier Pflicht: ohne sie liefert Medusa kein
    // calculated_price, der Wunschstrauss landete dann mit 20 EUR statt mit
    // dem gewaehlten Betrag im Warenkorb (Testbefund 07.09.2026).
    const res = (await apiCall("/store/products", {
      params: {
        handle: WUNSCHSTRAUSS_HANDLE,
        fields: "id,handle,*variants,*variants.calculated_price",
        limit: "1",
        region_id: REGION_ID,
      },
    })) as {
      products?: Array<{
        variants?: Array<{
          id: string;
          calculated_price?: { calculated_amount?: number };
        }>;
      }>;
    };
    const v = res.products?.[0]?.variants?.find((x) => x.id === variantId);
    return v?.calculated_price?.calculated_amount ?? null;
  } catch {
    return null;
  }
}

/** Positionen und Gesamtpreis, aus dem Warenkorb zurueckgelesen. */
export async function warenkorbAufstellung(cartId: string): Promise<{
  positionen: Array<{ bezeichnung: string; preis: number | null }>;
  gesamt: number | null;
}> {
  try {
    const res = (await apiCall(`/store/carts/${cartId}`)) as {
      cart?: {
        total?: number;
        items?: Array<{ title?: string; unit_price?: number; quantity?: number }>;
      };
    };
    return {
      gesamt: res.cart?.total ?? null,
      positionen:
        res.cart?.items?.map((i) => ({
          bezeichnung:
            (i.quantity ?? 1) > 1
              ? `${i.quantity}x ${i.title ?? "Position"}`
              : i.title ?? "Position",
          preis: i.unit_price ?? null,
        })) ?? [],
    };
  } catch {
    return { positionen: [], gesamt: null };
  }
}

export function fehler(
  type: string,
  message: string,
  extra: Record<string, unknown> = {}
) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ error: true, type, message, ...extra }, null, 2),
      },
    ],
    isError: true,
  };
}

export function antwort(daten: Record<string, unknown>) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(daten, null, 2) },
    ],
  };
}
