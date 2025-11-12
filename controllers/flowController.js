import axios from "axios";
import Message from "./models/Message.js";
import dotenv from "dotenv";
dotenv.config();

export const runFlow = async (flow, to) => {
  try {
    // find the start node
    let current = flow.nodes.find((n) => n.type === "input");

    while (current) {
      if (current.type === "default") {
        // send text message
        await sendWhatsAppMessage(to, current.data.label);
      }

      if (current.type === "mediaButtons") {
        await sendWhatsAppMedia(to, current.data);
        // stop flow for user choice
        break;
      }

      // find next edge
      const nextEdge = flow.edges.find((e) => e.source === current.id);
      current = nextEdge
        ? flow.nodes.find((n) => n.id === nextEdge.target)
        : null;
    }

    return { success: true };
  } catch (err) {
    console.error("Flow execution error:", err.message);
    return { success: false, error: err.message };
  }
};

const sendWhatsAppMessage = async (to, text) => {
  await axios.post(
    `https://graph.facebook.com/v20.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );

  await Message.create({ from: "system", to, message: text });
};

const sendWhatsAppMedia = async (to, data) => {
  await axios.post(
    `https://graph.facebook.com/v20.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: data.title || "Choose an option:" },
        action: {
          buttons: data.buttons.map((b, i) => ({
            type: "reply",
            reply: { id: `btn-${i}`, title: b },
          })),
        },
      },
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );

  await Message.create({ from: "system", to, message: data.title });
};
