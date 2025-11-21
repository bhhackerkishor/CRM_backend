// server.js
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import axios from "axios";

import connectDB from "./config/db.js";
import authRoutes from "./routes/auth.js";
import tenantRoutes from "./routes/tenant.js";
import contactRoutes from "./routes/contact.js";
import templateRoutes from "./routes/template.js";
import broadcastRoutes from "./routes/broadcast.js";
import messageRoutes from "./routes/message.js";
import flowRoutes from "./routes/flowRoutes.js";
import commerceRoutes from "./routes/commerceRoutes.js";

import { startScheduler } from "./services/scheduler.js";
import { startFlow, continueFlowByUserReply } from "./utils/flowRunner.js";

import Message from "./models/Message.js";
import Contact from "./models/Contact.js";
import Tenant from "./models/Tenant.js";
import Flow from "./models/Flow.js";
import FlowRun from "./models/FlowRun.js";
import Product from "./models/Product.js";
import Order from "./models/Order.js";

import { attachIo } from "./middleware/attachIo.js";

dotenv.config();
connectDB();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { path: "/socket.io" });

// CORS
const allowedOrigins = [
  "http://localhost:3000",
  "https://chatcom-phi.vercel.app",
  "https://crm-backend.onrender.com",
  "http://crm-backend.onrender.com",
];

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

app.use(bodyParser.json());
app.use(attachIo(io));

// Routes
app.get("/", (req, res) => res.send("ChatCom Backend Running"));
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/tenants", tenantRoutes);
app.use("/api/v1/contacts", contactRoutes);
app.use("/api/v1/templates", templateRoutes);
app.use("/api/v1/broadcasts", broadcastRoutes);
app.use("/api/v1/messages", messageRoutes);
app.use("/api/v1/flows", flowRoutes);
app.use("/api/v1/commerce", commerceRoutes);

startScheduler();

// === SEND CAROUSEL WITH IMAGES ===
const sendProductCarousel = async (userPhone, products, phoneNumberId) => {
  const items = products.slice(0, 10); // Max 10 cards

  const cards = items.map(p => ({
    card_index: items.indexOf(p),
    header: {
      type: "image",
      image: {
        link: p.image || "https://via.placeholder.com/400x300.png?text=No+Image",
      },
    },
    body: {
      text: `*${p.name}*\n₹${p.price}\n${(p.description || "").slice(0, 60)}`,
    },
    footer: { text: "In Stock • Fast Delivery" },
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

  await axios.post(
    `https://graph.facebook.com/v24.0/${phoneNumberId}/messages`,
    {
      messaging_product: "whatsapp",
      to: userPhone,
      type: "interactive",
      interactive: { type: "carousel", cards },
    },
    { headers: { Authorization: `Bearer ${process.env.ACCESS_TOKEN}` } }
  );
};

// === WhatsApp Webhook Verification ===
app.get("/api/webhook", (req, res) => {
  const { "hub.mode": mode, "hub.verify_token": token, "hub.challenge": challenge } = req.query;
  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// === WhatsApp Webhook Receiver ===
app.post("/api/webhook", async (req, res) => {
  try {
    const value = req.body.entry?.[0]?.changes?.[0]?.value;
    if (!value?.messages?.[0]) return res.sendStatus(200);

    const msg = value.messages[0];
    const userPhone = msg.from;
    const phoneNumberId = value.metadata.phone_number_id;

    const tenant = await Tenant.findOne({ phoneNumberId });
    if (!tenant) return res.sendStatus(404);

    const tenantId = tenant._id;

    // Upsert contact
    const contact = await Contact.findOneAndUpdate(
      { phone: userPhone, tenantId },
      { name: value.contacts?.[0]?.profile?.name || "User", lastIncomingAt: new Date() },
      { upsert: true, new: true }
    );

    const text = msg.text?.body || msg.interactive?.button_reply?.title || "[Media]";

    // === 1. Product Selected from Carousel ===
    if (msg.interactive?.button_reply?.id?.startsWith("BUY_")) {
      const productId = msg.interactive.button_reply.id.replace("BUY_", "");
      const product = await Product.findById(productId);

      if (!product) {
        await axios.post(`https://graph.facebook.com/v24.0/${phoneNumberId}/messages`, {
          messaging_product: "whatsapp",
          to: userPhone,
          type: "text",
          text: { body: "Sorry, that product is no longer available." },
        }, { headers: { Authorization: `Bearer ${process.env.ACCESS_TOKEN}` } });
        return res.sendStatus(200);
      }

      await axios.post(
        `${process.env.BACKEND_URL || "https://crm-backend-c54a.onrender.com"}/api/v1/commerce/order`,
        {
          phone: userPhone,
          tenantId: tenant._id,
          items: [{ name: product.name, price: product.price, qty: 1 }],
        }
      );

      return res.sendStatus(200);
    }

    // === 2. User Tapped "Pay Now" Button ===
    if (msg.interactive?.button_reply?.id === "PAY_NOW") {
      const order = await Order.findOne({ phone: userPhone, status: "pending" }).sort({ createdAt: -1 });
      if (order?.paymentLinkId) {
        await axios.post(`https://graph.facebook.com/v24.0/${phoneNumberId}/messages`, {
          messaging_product: "whatsapp",
          to: userPhone,
          type: "text",
          text: { body: `Payment link (reminder):\nhttps://rzp.io/l/${order.paymentLinkId}` },
        }, { headers: { Authorization: `Bearer ${process.env.ACCESS_TOKEN}` } });
      }
      return res.sendStatus(200);
    }

    // === 3. User says "hi" → Show Products with Images ===
    if (text.trim().toLowerCase() === "hi") {
      const products = await Product.find({ tenantId }); // or .find({}) if global
      await sendProductCarousel(userPhone, products, phoneNumberId);
      return res.sendStatus(200);
    }

    // === 4. Save Message & Flow Logic ===
    await Message.create({
      tenantId,
      contact: contact._id,
      from: userPhone,
      to: phoneNumberId,
      message: text,
      direction: "inbound",
      status: "delivered",
    });

    io.to(`tenant_${tenantId}`).emit("newMessage", { userPhone, text });

    // Flow handling (your existing logic)
    const waitingRun = await FlowRun.findOne({ userPhone, tenantId, status: "waiting" }).sort({ updatedAt: -1 });
    if (waitingRun) {
      const reply = msg.interactive?.button_reply?.id || text;
      await continueFlowByUserReply(userPhone, reply);
      return res.sendStatus(200);
    }

    // Trigger flow by keyword
    const flows = await Flow.find({ tenantId, isActive: true, "triggers.keywords": { $exists: true, $ne: [] } });
    for (const flow of flows) {
      if (flow.triggers.keywords.some(kw => text.trim().toLowerCase() === kw.toLowerCase())) {
        await startFlow(flow._id, userPhone);
        return res.sendStatus(200);
      }
    }

    if (tenant.defaultFlowId) await startFlow(tenant.defaultFlowId, userPhone);

    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err.response?.data || err);
    res.sendStatus(500);
  }
});

// === Socket.IO ===
io.on("connection", (socket) => {
  socket.on("joinTenant", (tenantId) => socket.join(`tenant_${tenantId}`));
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});