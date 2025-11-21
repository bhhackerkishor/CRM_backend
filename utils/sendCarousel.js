// utils/sendCarousel.js
import axios from "axios";

export const sendProductCarousel = async (userPhone, products, tenantPhoneId) => {
  // Limit to 10 products
  const items = products.slice(0, 10);

  const cards = items.map((p, index) => ({
    card_index: index,
    header: {
      type: "image",
      image: {
        link: p.image || "https://via.placeholder.com/300x200.png?text=No+Image", // fallback
      },
    },
    body: {
      text: `*${p.name}*\n₹${p.price}\n${p.description?.slice(0, 60) || ""}`,
    },
    footer: { text: "Secure Payment" },
    action: {
      buttons: [
        {
          type: "reply",
          reply: {
            id: `BUY_${p._id}`,
            title: "Buy Now",
          },
        },
      ],
    },
  }));

  return await axios.post(
    `https://graph.facebook.com/v24.0/${tenantPhoneId}/messages`,
    {
      messaging_product: "whatsapp",
      to: userPhone,
      type: "interactive",
      interactive: {
        type: "carousel",
        cards,
      },
    },
    {
      headers: { Authorization: `Bearer ${process.env.ACCESS_TOKEN}` },
    }
  );
};