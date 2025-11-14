// src/services/whatsapp.js
import axios from "axios";

export const sendWhatsAppMessage = async (to, templateId, variables = {}) => {
  const tenant = await require("../models/Tenant.js").default.findOne({ "contacts.phone": to });
  if (!tenant?.accessToken || !tenant?.phoneNumberId) throw new Error("WhatsApp not configured");

  const params = Object.values(variables);
  await axios.post(
    `https://graph.facebook.com/v20.0/${tenant.phoneNumberId}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateId,
        language: { code: "en" },
        components: [
          {
            type: "body",
            parameters: params.map((text) => ({ type: "text", text })),
          },
        ],
      },
    },
    { headers: { Authorization: `Bearer ${tenant.accessToken}` } }
  );
};