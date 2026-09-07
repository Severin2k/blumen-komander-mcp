import { z } from "zod";
import { apiCall, ApiError, PUBLIC_URL } from "../api/client.js";

export const searchFlowersSchema = {
  occasion: z
    .enum([
      "geburtstag",
      "jubiläum",
      "hochzeit",
      "trauer",
      "liebe",
      "dankeschön",
      "business",
      "muttertag",
      "ostern",
      "weihnachten",
      "allgemein",
    ])
    .optional()
    .describe("Anlass für die Blumen"),
  color: z
    .enum([
      "rot",
      "rosa",
      "weiß",
      "gelb",
      "orange",
      "lila",
      "gemischt",
      "grün",
    ])
    .optional()
    .describe("Gewünschte Farbe"),
  flower_type: z
    .enum([
      "rosen",
      "tulpen",
      "ranunkeln",
      "pfingstrosen",
      "sonnenblumen",
      "gemischt",
      "saisonal",
    ])
    .optional()
    .describe("Blumenart"),
  style: z
    .enum([
      "klassisch",
      "modern",
      "romantisch",
      "minimalistisch",
      "wild",
      "elegant",
    ])
    .optional()
    .describe("Stil des Straußes"),
  maxPrice: z.number().optional().describe("Höchstpreis in EUR"),
  minPrice: z.number().optional().describe("Mindestpreis in EUR"),
  limit: z
    .number()
    .optional()
    .describe("Wieviele Sträuße zurückgeben (Standard 24, höchstens 50)"),
  offset: z
    .number()
    .optional()
    .describe("Für weitere Seiten: wieviele Treffer überspringen"),
};

/** Zubehoer wie Vase, Ballon oder Grusskarte traegt keine Blumen-Metadaten. */
function istStrauss(p: { metadata?: Record<string, unknown> }): boolean {
  const m = p.metadata || {};
  return ["occasion", "color", "flower_type", "style"].some(
    (k) => Array.isArray(m[k]) && (m[k] as unknown[]).length > 0
  );
}

const BACKEND_MAX = 50;
const MAX_SEITEN = 4;

export async function searchFlowers(args: {
  occasion?: string;
  color?: string;
  flower_type?: string;
  style?: string;
  maxPrice?: number;
  minPrice?: number;
  limit?: number;
  offset?: number;
}) {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null) continue;
    // limit/offset steuert der MCP selbst, siehe unten.
    if (key === "limit" || key === "offset") continue;
    params[key] = String(value);
  }

  try {
    type Suchtreffer = {
      id: string;
      handle: string;
      title: string;
      description?: string | null;
      variants?: Array<{
        id: string;
        title: string;
        calculated_price?: { calculated_amount?: number };
        price?: number;
        slightly_above_budget?: boolean;
      }>;
      thumbnail: string | null;
      metadata?: Record<string, unknown>;
    };

    // Die Suchroute sortiert ohne Budgetangabe nach Preis aufsteigend und
    // liefert per Voreinstellung 10 Treffer. Die guenstigsten Artikel sind
    // Grusskarten zu 3,90 EUR - eine Suche ohne Filter zeigte deshalb bis
    // 07.09.2026 neun Grusskarten und eine Schachtel Pralinen und behauptete
    // dabei count 10, obwohl der Shop 58 Artikel fuehrt. Deshalb wird hier
    // vollstaendig geladen, Zubehoer getrennt und erst danach paginiert.
    const alle: Suchtreffer[] = [];
    for (let seite = 0; seite < MAX_SEITEN; seite++) {
      const antwort = (await apiCall("/store/products/search", {
        params: {
          ...params,
          limit: String(BACKEND_MAX),
          offset: String(seite * BACKEND_MAX),
        },
      })) as { products?: Suchtreffer[] };
      const teil = antwort.products ?? [];
      alle.push(...teil);
      if (teil.length < BACKEND_MAX) break;
    }

    const straeusse = alle.filter(istStrauss);
    const zubehoer = alle.filter((p) => !istStrauss(p));

    const limit = Math.min(Math.max(args.limit ?? 24, 1), 50);
    const offset = Math.max(args.offset ?? 0, 0);
    const seitenAusschnitt = straeusse.slice(offset, offset + limit);

    const data = { products: seitenAusschnitt };

    // Das Backend zeigt bewusst bis 15 % ueber maxPrice und markiert diese
    // Varianten mit slightly_above_budget. Beides sowie die Beschreibung wurde
    // hier bis 07.09.2026 weggemappt - die KI nannte dem Kunden dann 64,90 EUR
    // als Treffer fuer ein 60-EUR-Budget, ohne Hinweis und ohne Beschreibung.
    const products =
      data.products?.map((p) => ({
        id: p.id,
        handle: p.handle,
        title: p.title,
        description: p.description ?? null,
        variants: p.variants?.map((v) => ({
          id: v.id,
          title: v.title,
          price: v.calculated_price?.calculated_amount ?? v.price,
          ueber_budget: v.slightly_above_budget === true,
          ...(v.slightly_above_budget === true
            ? {
                budget_hinweis: `Liegt über dem genannten Budget von ${args.maxPrice} EUR. Dem Kunden den Preis nennen und fragen, ob das in Ordnung ist.`,
              }
            : {}),
        })),
        thumbnail: p.thumbnail,
        url: `${PUBLIC_URL}/de/products/${p.handle}`,
        metadata: p.metadata,
      })) ?? [];

    const ueberBudget = products.filter((p) =>
      p.variants?.some((v) => v.ueber_budget)
    ).length;

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              products,
              count: products.length,
              treffer_gesamt: straeusse.length,
              angezeigt: `${offset + 1}-${offset + products.length} von ${straeusse.length}`,
              ...(offset + products.length < straeusse.length
                ? {
                    weitere_hinweis: `Es gibt ${straeusse.length - offset - products.length} weitere Sträuße. Mit offset: ${offset + products.length} nachladen.`,
                  }
                : {}),
              ...(zubehoer.length
                ? {
                    zubehoer: zubehoer.map((z) => ({
                      titel: z.title,
                      handle: z.handle,
                      ab_preis:
                        z.variants?.[0]?.calculated_price?.calculated_amount ??
                        z.variants?.[0]?.price ??
                        null,
                    })),
                    zubehoer_hinweis:
                      "Vasen, Ballons, Pralinen, Prosecco und Grußkarten sind Zubehör, keine Sträuße. Sie stehen bewusst nicht in der Trefferliste, damit sie nicht als Blumenvorschlag missverstanden werden. create_cart legt derzeit nur einen Artikel an - Zubehör kann der Kunde im Shop dazulegen.",
                  }
                : {}),
              bild_hinweis:
                "thumbnail ist eine Bild-URL. Wenn der Kunde den Strauß wirklich sehen soll, get_product_image mit dem handle aufrufen - das liefert das Foto als echtes Bild statt als Link. Nur für die ein bis drei Sträuße aufrufen, über die gesprochen wird.",
              ...(ueberBudget > 0
                ? {
                    budget_hinweis: `${ueberBudget} der Treffer liegen leicht über dem Budget von ${args.maxPrice} EUR (bis 15 % darüber wird mitgezeigt). Sie sind mit "ueber_budget": true markiert - diese Sträuße nur mit ausdrücklichem Preishinweis vorschlagen.`,
                  }
                : {}),
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
