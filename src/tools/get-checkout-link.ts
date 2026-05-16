import { z } from "zod";
import { apiCall, ApiError, PUBLIC_URL } from "../api/client.js";

export const getCheckoutLinkSchema = {
  cart_id: z.string().describe("ID des Warenkorbs"),
};

export async function getCheckoutLink(args: { cart_id: string }) {
  const cartId = args.cart_id;

  try {
    const data = (await apiCall(`/store/carts/${cartId}`)) as {
      cart: {
        email?: string;
        items?: Array<{
          title: string;
          quantity: number;
          unit_price: number;
        }>;
        metadata?: { delivery_date?: string; greeting_card?: string };
        shipping_address?: {
          first_name: string;
          last_name: string;
          address_1: string;
          postal_code: string;
          city: string;
        };
        total?: number;
      };
    };
    const cart = data.cart;

    const checkoutUrl = `${PUBLIC_URL}/de/checkout?cartId=${cartId}&step=payment`;

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              checkout_url: checkoutUrl,
              summary: {
                email: cart.email,
                items: cart.items?.map((i) => ({
                  title: i.title,
                  quantity: i.quantity,
                  price: i.unit_price,
                })),
                delivery_date: cart.metadata?.delivery_date,
                recipient: cart.shipping_address
                  ? `${cart.shipping_address.first_name} ${cart.shipping_address.last_name}`
                  : null,
                address: cart.shipping_address
                  ? `${cart.shipping_address.address_1}, ${cart.shipping_address.postal_code} ${cart.shipping_address.city}`
                  : null,
                total: cart.total,
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
