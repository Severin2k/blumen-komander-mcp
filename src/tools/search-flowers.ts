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
        variants?: Array<{
          id: string;
          title: string;
          calculated_price?: { calculated_amount?: number };
          price?: number;
        }>;
        thumbnail: string | null;
        metadata?: Record<string, unknown>;
      }>;
    };

    const products =
      data.products?.map((p) => ({
        id: p.id,
        handle: p.handle,
        title: p.title,
        variants: p.variants?.map((v) => ({
          id: v.id,
          title: v.title,
          price: v.calculated_price?.calculated_amount ?? v.price,
        })),
        thumbnail: p.thumbnail,
        url: `${PUBLIC_URL}/de/products/${p.handle}`,
        metadata: p.metadata,
      })) ?? [];

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ products, count: products.length }, null, 2),
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
