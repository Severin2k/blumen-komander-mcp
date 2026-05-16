import { z } from "zod";
import { apiCall, ApiError, PUBLIC_URL, REGION_ID } from "../api/client.js";

export const createCartSchema = {
  variant_id: z.string().describe("ID der gewählten Produktvariante"),
  quantity: z.number().optional().describe("Anzahl (Standard: 1)"),
  delivery_date: z.string().describe("Lieferdatum YYYY-MM-DD"),
  first_name: z.string().describe("Vorname Empfänger"),
  last_name: z.string().describe("Nachname Empfänger"),
  address_1: z.string().describe("Straße und Hausnummer"),
  postal_code: z.string().describe("PLZ"),
  city: z.string().optional().describe("Stadt (Standard: München)"),
  phone: z.string().optional().describe("Telefonnummer Empfänger"),
  email: z.string().describe("E-Mail des Bestellers"),
  billing_first_name: z
    .string()
    .optional()
    .describe("Vorname Rechnungsadresse"),
  billing_last_name: z
    .string()
    .optional()
    .describe("Nachname Rechnungsadresse"),
  billing_address_1: z
    .string()
    .optional()
    .describe("Straße Rechnungsadresse"),
  billing_postal_code: z.string().optional().describe("PLZ Rechnungsadresse"),
  billing_city: z.string().optional().describe("Stadt Rechnungsadresse"),
  greeting_card: z.string().optional().describe("Text für die Grußkarte"),
  payment_provider: z
    .enum(["stripe", "paypal", "sepa"])
    .optional()
    .describe(
      "Zahlungsmethode: stripe (Kreditkarte, Apple Pay, Google Pay), paypal oder sepa (SEPA-Lastschrift). Standard: stripe."
    ),
};

export async function createCart(args: {
  variant_id: string;
  quantity?: number;
  delivery_date: string;
  first_name: string;
  last_name: string;
  address_1: string;
  postal_code: string;
  city?: string;
  phone?: string;
  email: string;
  billing_first_name?: string;
  billing_last_name?: string;
  billing_address_1?: string;
  billing_postal_code?: string;
  billing_city?: string;
  greeting_card?: string;
  payment_provider?: string;
}) {
  try {
    // Step 1: Create cart
    const cartRes = (await apiCall("/store/carts", {
      method: "POST",
      body: { region_id: REGION_ID },
    })) as { cart: { id: string } };
    const cartId = cartRes.cart.id;

    // Step 2: Add line item
    await apiCall(`/store/carts/${cartId}/line-items`, {
      method: "POST",
      body: {
        variant_id: args.variant_id,
        quantity: args.quantity || 1,
      },
    });

    // Step 3: Get shipping options
    const shippingRes = (await apiCall("/store/shipping-options", {
      params: { cart_id: cartId },
    })) as { shipping_options?: Array<{ id: string }> };

    const shippingOptionId = shippingRes.shipping_options?.[0]?.id;
    if (!shippingOptionId) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: true,
              message:
                "Keine Versandoption verfügbar. Möglicherweise liegt die PLZ außerhalb des Liefergebiets.",
              type: "no_shipping_option",
              cart_id: cartId,
            }),
          },
        ],
        isError: true,
      };
    }

    // Step 4: Set shipping method
    await apiCall(`/store/carts/${cartId}/shipping-methods`, {
      method: "POST",
      body: { option_id: shippingOptionId },
    });

    // Step 5: Update cart with addresses and metadata
    const shippingAddress = {
      first_name: args.first_name,
      last_name: args.last_name,
      address_1: args.address_1,
      postal_code: args.postal_code,
      city: args.city || "München",
      country_code: "de",
      phone: args.phone || "",
    };

    const billingAddress = args.billing_first_name
      ? {
          first_name: args.billing_first_name,
          last_name: args.billing_last_name,
          address_1: args.billing_address_1,
          postal_code: args.billing_postal_code,
          city: args.billing_city || "München",
          country_code: "de",
        }
      : shippingAddress;

    const metadata: Record<string, unknown> = {
      delivery_date: args.delivery_date,
      delivery_mode: "lieferung",
    };
    if (args.greeting_card) {
      metadata.greeting_card = args.greeting_card;
    }

    await apiCall(`/store/carts/${cartId}`, {
      method: "POST",
      body: {
        email: args.email,
        shipping_address: shippingAddress,
        billing_address: billingAddress,
        metadata,
      },
    });

    // Step 6: Initialize payment collection and session
    const providerMap: Record<string, string> = {
      stripe: "pp_stripe_stripe",
      paypal: "pp_paypal_paypal",
      sepa: "pp_stripe_stripe",
    };
    const providerId =
      providerMap[(args.payment_provider as string) || "stripe"] ||
      "pp_stripe_stripe";

    const pcRes = (await apiCall("/store/payment-collections", {
      method: "POST",
      body: { cart_id: cartId },
    })) as { payment_collection: { id: string } };

    await apiCall(
      `/store/payment-collections/${pcRes.payment_collection.id}/payment-sessions`,
      {
        method: "POST",
        body: { provider_id: providerId },
      }
    );

    const checkoutUrl = `${PUBLIC_URL}/de/checkout?cartId=${cartId}&step=payment`;

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              cart_id: cartId,
              checkout_url: checkoutUrl,
              summary: {
                delivery_date: args.delivery_date,
                recipient: `${args.first_name} ${args.last_name}`,
                address: `${args.address_1}, ${args.postal_code} ${args.city || "München"}`,
                greeting_card: args.greeting_card || null,
                email: args.email,
                delivery_fee: 0,
                payment_method: args.payment_provider || "stripe",
              },
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
