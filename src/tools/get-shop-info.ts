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
            delivery_area:
              "München, PLZ 80331-81929, sowie Neubiberg (85579)",
            delivery_fee: "Kostenlose Lieferung in München",
            delivery_days: "Montag bis Samstag",
            // Identisch mit Startseite, llms.txt und /store/availability.
            // Stand hier bis 06.09.2026 fest auf "12:00 Uhr" - das war der
            // Samstagswert und galt faelschlich fuer die ganze Woche.
            same_day_cutoff: "Mo-Fr bis 16:00 Uhr, Sa bis 12:00 Uhr",
            same_day_cutoff_hochlast:
              "Muttertag und Valentinstag bis 10:00 Uhr",
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
