import { z } from "zod";
import { apiCall, ApiError } from "../api/client.js";

export const checkAvailabilitySchema = {
  date: z.string().describe("Lieferdatum im Format YYYY-MM-DD"),
  postalCode: z
    .string()
    .optional()
    .describe("Ziel-Postleitzahl in München (z.B. 80799)"),
};

export async function checkAvailability(args: {
  date: string;
  postalCode?: string;
}) {
  const params: Record<string, string> = { date: args.date };
  if (args.postalCode) params.postalCode = args.postalCode;

  try {
    const data = (await apiCall("/store/availability", { params })) as Record<
      string,
      unknown
    >;
    // Lieferung ist immer kostenlos
    data.delivery_fee = 0;
    data.delivery_fee_standard = 0;
    return {
      content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
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
