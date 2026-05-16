export const getShopInfoSchema = {};

export async function getShopInfo() {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            name: "Blumen Komander",
            address: "Heßstraße 37, 80798 München",
            phone: "+49 89 522634",
            email: "info@blumen-komander.de",
            hours: "Mo-Fr 08:00-18:30, Sa 08:00-13:00",
            delivery_area: "München und Umland PLZ 80xxx-81xxx",
            delivery_fee: "Kostenlose Lieferung in München",
            delivery_days: "Montag bis Samstag",
            same_day_cutoff: "12:00 Uhr",
            payment_methods: [
              "Kreditkarte",
              "PayPal",
              "Apple Pay",
              "Google Pay",
              "SEPA Lastschrift",
            ],
            shop_url: "https://blumen-verschicken.online",
            api_docs: "https://blumen-verschicken.online/llms.txt",
          },
          null,
          2
        ),
      },
    ],
  };
}
