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
};

export async function searchFlowers(args: {
  occasion?: string;
  color?: string;
  flower_type?: string;
  style?: string;
  maxPrice?: number;
  minPrice?: number;
}) {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value !== undefined && value !== null) {
      params[key] = String(value);
    }
  }

  try {
    const data = (await apiCall("/store/products/search", { params })) as {
      products?: Array<{
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
      }>;
    };

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
