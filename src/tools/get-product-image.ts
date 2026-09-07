import { z } from "zod";
import { apiCall, ApiError, PUBLIC_URL } from "../api/client.js";

/**
 * Liefert Produktfotos als echten MCP-image-Block statt nur als URL.
 *
 * Warum ein eigenes Tool und nicht Bilder in search_flowers:
 * Ein Bild kostet den Assistenten rund 1.300 Token. Bei zehn Suchtreffern
 * waere jede Suche unbrauchbar teuer. Hier holt die KI gezielt das Foto zu
 * den ein bis drei Straeussen, ueber die der Kunde wirklich spricht.
 *
 * search_flowers liefert weiterhin die thumbnail-URL - fuer Clients, die
 * Bilder per Link anzeigen, reicht das und kostet nichts.
 */

/** Nur der eigene Medienserver. Verhindert, dass das Tool als Proxy fuer
 *  beliebige URLs missbraucht werden kann. */
const ERLAUBTE_HOSTS = [
  "media.blumen-verschicken.online",
  "blumen-verschicken.online",
];

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_BILDER = 3;

export const getProductImageSchema = {
  handle: z
    .string()
    .optional()
    .describe(
      "Handle des Produkts, z. B. 'mary'. Steht in der Antwort von search_flowers."
    ),
  product_id: z
    .string()
    .optional()
    .describe("Alternativ die Produkt-ID aus search_flowers, z. B. 'prod_...'"),
  alle_bilder: z
    .boolean()
    .optional()
    .describe(
      "true = alle vorhandenen Ansichten (höchstens 3). Standard: nur das Hauptbild."
    ),
};

interface StoreProduct {
  id: string;
  title: string;
  handle: string;
  description?: string | null;
  thumbnail?: string | null;
  images?: Array<{ url?: string }>;
}

async function ladeBild(
  url: string
): Promise<{ data: string; mimeType: string } | { fehler: string }> {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return { fehler: `Ungültige Bild-URL: ${url}` };
  }
  if (!ERLAUBTE_HOSTS.includes(host)) {
    return { fehler: `Bild liegt nicht auf dem eigenen Medienserver: ${host}` };
  }

  const steuerung = new AbortController();
  const abbruch = setTimeout(() => steuerung.abort(), 15000);
  try {
    const res = await fetch(url, { signal: steuerung.signal });
    if (!res.ok) return { fehler: `Bild nicht abrufbar (HTTP ${res.status})` };

    const mimeType = res.headers.get("content-type")?.split(";")[0] ?? "";
    if (!mimeType.startsWith("image/")) {
      return { fehler: `Kein Bild, sondern ${mimeType || "unbekannt"}` };
    }

    const puffer = Buffer.from(await res.arrayBuffer());
    if (puffer.byteLength > MAX_BYTES) {
      return { fehler: `Bild zu groß (${puffer.byteLength} Bytes)` };
    }
    return { data: puffer.toString("base64"), mimeType };
  } catch (e) {
    return {
      fehler: e instanceof Error && e.name === "AbortError"
        ? "Zeitüberschreitung beim Laden des Bildes"
        : "Bild konnte nicht geladen werden",
    };
  } finally {
    clearTimeout(abbruch);
  }
}

export async function getProductImage(args: {
  handle?: string;
  product_id?: string;
  alle_bilder?: boolean;
}) {
  if (!args.handle && !args.product_id) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: true,
            type: "missing_parameter",
            message:
              "Bitte handle oder product_id angeben. Beides steht in der Antwort von search_flowers.",
          }),
        },
      ],
      isError: true,
    };
  }

  try {
    const params: Record<string, string> = {
      fields: "id,title,handle,description,thumbnail,*images",
      limit: "1",
    };
    if (args.handle) params.handle = args.handle;
    else if (args.product_id) params.id = args.product_id!;

    const res = (await apiCall("/store/products", { params })) as {
      products?: StoreProduct[];
    };
    const produkt = res.products?.[0];

    if (!produkt) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: true,
              type: "not_found",
              message: `Kein Produkt gefunden zu ${args.handle ?? args.product_id}. Handle und ID stehen in der Antwort von search_flowers.`,
            }),
          },
        ],
        isError: true,
      };
    }

    // Hauptbild zuerst, dann die weiteren Ansichten, ohne Dubletten.
    const urls: string[] = [];
    if (produkt.thumbnail) urls.push(produkt.thumbnail);
    for (const bild of produkt.images ?? []) {
      if (bild.url && !urls.includes(bild.url)) urls.push(bild.url);
    }
    const gewaehlt = (args.alle_bilder ? urls : urls.slice(0, 1)).slice(
      0,
      MAX_BILDER
    );

    if (gewaehlt.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: true,
              type: "no_image",
              message: `Für "${produkt.title}" ist kein Foto hinterlegt.`,
              url: `${PUBLIC_URL}/de/products/${produkt.handle}`,
            }),
          },
        ],
        isError: true,
      };
    }

    const inhalt: Array<
      | { type: "text"; text: string }
      | { type: "image"; data: string; mimeType: string }
    > = [];
    const fehler: string[] = [];

    for (const url of gewaehlt) {
      const bild = await ladeBild(url);
      if ("fehler" in bild) fehler.push(`${url}: ${bild.fehler}`);
      else inhalt.push({ type: "image", data: bild.data, mimeType: bild.mimeType });
    }

    const anzahlWeitere = urls.length - gewaehlt.length;
    inhalt.push({
      type: "text",
      text: JSON.stringify(
        {
          produkt: produkt.title,
          handle: produkt.handle,
          beschreibung: produkt.description ?? null,
          url: `${PUBLIC_URL}/de/products/${produkt.handle}`,
          bilder_geliefert: inhalt.filter((c) => c.type === "image").length,
          weitere_ansichten_verfuegbar: anzahlWeitere > 0 ? anzahlWeitere : 0,
          ...(anzahlWeitere > 0
            ? {
                hinweis:
                  "Mit alle_bilder: true gibt es die weiteren Ansichten (höchstens 3 pro Aufruf).",
              }
            : {}),
          ...(fehler.length ? { nicht_geladen: fehler } : {}),
        },
        null,
        2
      ),
    });

    // Kein Bild geladen? Dann ist das ein Fehlschlag, kein Erfolg mit Textblock.
    if (!inhalt.some((c) => c.type === "image")) {
      return { content: inhalt, isError: true };
    }

    return { content: inhalt };
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
