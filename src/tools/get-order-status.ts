import { z } from "zod";
import { apiCall, ApiError } from "../api/client.js";

export const getOrderStatusSchema = {
  order_number: z
    .string()
    .describe("Bestellnummer (z.B. 114, steht in der Bestellbestätigung)"),
  email: z
    .string()
    .describe("E-Mail-Adresse des Bestellers (zur Verifikation)"),
};

export async function getOrderStatus(args: {
  order_number: string;
  email: string;
}) {
  try {
    const data = await apiCall("/store/order-status", {
      params: {
        order_number: args.order_number,
        email: args.email,
      },
    });

    return {
      content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    };
  } catch (error) {
    if (error instanceof ApiError) {
      const notFound = error.statusCode === 404;
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: true,
              message: notFound
                ? "Keine Bestellung mit dieser Nummer und E-Mail-Adresse gefunden. Bitte beide Angaben prüfen."
                : error.message,
              type: notFound ? "order_not_found" : error.type,
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
