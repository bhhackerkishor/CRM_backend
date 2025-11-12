// flowRunner.js
import axios from "axios";
import dotenv from "dotenv";
import fs from "fs";
import Message from "./models/Message.js";
//import flow from "./sampleFlow.json" assert { type: "json" }; 

dotenv.config();

// Load your flow (like the JSON you pasted)

const flow = JSON.parse(fs.readFileSync("./sampleFlow.json", "utf-8"));

// WhatsApp send helpers
async function sendText(to, text) {
  console.log(`💬 Sending message to ${to}:`, text);
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
}

async function sendInteractive(to, data) {
  console.log(`📩 Sending mediaButtons node to ${to}`);

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      header: {},
      body: { text: data.title || "Choose an option:" },
      action: {
        buttons: data.buttons.map((b, i) => ({
          type: "reply",
          reply: { id: `btn-${i}`, title: b },
        })),
      },
    },
  };

  // ✅ Add image if provided
  if (data.image) {
    payload.interactive.header = {
      type: "image",
      image: { link: data.image }, // URL directly
    };
  }

  await axios.post(
    `https://graph.facebook.com/v20.0/${process.env.PHONE_NUMBER_ID}/messages`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${process.env.ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );

  await Message.create({
    from: "system",
    to,
    message: data.title,
    direction: "out",
    status: "sent",
    media: data.image || null,
  });
}

// 🧠 Run Flow Logic
export async function runFlow(to) {
  console.log("🚀 Running flow for:", to);

  let current = flow.nodes.find((n) => n.type === "input");

  while (current) {
    console.log(`▶ Executing node ${current.id} (${current.type})`);

    if (current.type === "message") {
      await sendText(to, current.data.label);
    }

    if (current.type === "mediaButtons") {
      await sendInteractive(to, current.data);
      // Stop flow — wait for user interaction
      break;
    }

    // Find next edge
    const nextEdge = flow.edges.find((e) => e.source === current.id);
    current = nextEdge
      ? flow.nodes.find((n) => n.id === nextEdge.target)
      : null;
  }


  console.log("✅ Flow execution finished");
}

export async function continueFlowFromButton(user, replyId) {
  try {
    // Load flow
    const flow = JSON.parse(fs.readFileSync("./sampleFlow.json", "utf-8"));

    // Find the edge that matches this button
    const matchingEdge = flow.edges.find((e) => e.sourceHandle === replyId);
    if (!matchingEdge) {
      console.log("⚠️ No matching edge for", replyId);
      return;
    }

    // Find the next node to send
    const nextNode = flow.nodes.find((n) => n.id === matchingEdge.target);
    if (!nextNode) return;

    console.log(`➡️ Continuing flow for ${user} to node ${nextNode.id}`);

    if (nextNode.type === "message") {
      await sendText(user, nextNode.data.label);
    } else if (nextNode.type === "mediaButtons") {
      await sendInteractive(user, nextNode.data);
    }
  } catch (err) {
    console.error("❌ continueFlowFromButton error:", err.message);
  }
}

