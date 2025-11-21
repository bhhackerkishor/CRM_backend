// server.js
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import axios from "axios"

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
import Product from "./models/Product.js"
import Order from "./models/Order.js";


// server.js (top, after io creation)
import { attachIo } from "./middleware/attachIo.js";


dotenv.config();

async function sendMessage(to, from, body) {
  await axios.post(
    `https://graph.facebook.com/v20.0/${from}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    },
    {
      headers: { Authorization: `Bearer ${process.env.ACCESS_TOKEN}` },
    }
  );
}



// === App Setup ===
const app = express();


app.use(bodyParser.json());


const allowedOrigins = [
  "http://localhost:3000",
  "https://chatcom-phi.vercel.app",
  "https://crm-backend.onrender.com",
  "http://crm-backend.onrender.com"
];

// UNIVERSAL CORS (Render Safe)
const corsOptions = {
  origin: allowedOrigins, // Frontend origin (or '*' for any)
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

app.use(cors(corsOptions));

// HTTP + Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
  path: "/socket.io",
});


// === DB ===
connectDB();

// === Middleware: Attach io + tenant + user to req ===
app.use(attachIo(io));

// === Routes ===
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

// === WhatsApp Webhook Verification ===
app.get("/api/webhook", (req, res) => {
  const { "hub.mode": mode, "hub.verify_token": token, "hub.challenge": challenge } = req.query;
  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    console.log("Webhook verified");
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// === WhatsApp Webhook Receiver ===
app.post("/api/webhook", async (req, res) => {
  try {
    const value = req.body.entry?.[0]?.changes?.[0]?.value;
    console.log(value,req.body)
    if (!value?.messages?.[0]) return res.sendStatus(200);

    const msg = value.messages[0];
    const userPhone = msg.from;
    const tenantPhoneId = value.metadata.phone_number_id;

    const tenant = await Tenant.findOne({ phoneNumberId: tenantPhoneId });
    if (!tenant) return res.sendStatus(404);

    const tenantId = tenant._id;
    const profileName = value.contacts?.[0]?.profile?.name || "";

    // === Upsert Contact ===
    const contact = await Contact.findOneAndUpdate(
      { phone: userPhone, tenantId },
      { name: profileName, lastIncomingAt: new Date(), source: "whatsapp" },
      { upsert: true, new: true }
    );

    // === Extract Message Text ===
    const text =
      msg.text?.body ||
      msg.interactive?.button_reply?.title ||
      "[Media/Unsupported]";

      // Handle list reply
if (msg.interactive?.list_reply?.id?.startsWith("BUY_")) {
  const productId = msg.interactive.list_reply.id.replace("BUY_", "");

  const product = await Product.findById(productId);
  if (!product) {
    await sendMessage(userPhone, tenantPhoneId, "Product not available.");
    return res.sendStatus(200);
  }

  // Create order
  await axios.post(
    `${process.env.BACKEND_URL || "http://localhost:5000"}/api/v1/commerce/order`,
    {
      phone: userPhone,
      tenantId: tenant._id,
      items: [{ name: product.name, price: product.price, qty: 1 }],
    }
  );

  return res.sendStatus(200);
}

      if (msg.interactive?.button_reply?.id === "PAY_NOW") {
        // Find the latest pending order for this user
        const pendingOrder = await Order.findOne({
          phone: userPhone,
          status: "pending",
        }).sort({ createdAt: -1 });
      
        if (pendingOrder) {
          // Optionally re-send the payment link (in case they missed it)
          const tenant = await Tenant.findById(pendingOrder.tenantId);
          const phoneNumberId = tenant?.phoneNumberId || process.env.PHONE_NUMBER_ID;
      
          await axios.post(
            `https://graph.facebook.com/v24.0/${phoneNumberId}/messages`,
            {
              messaging_product: "whatsapp",
              to: userPhone,
              type: "text",
              text: { body: `Payment link: ${pendingOrder.paymentLinkId ? `https://rzp.io/l/${pendingOrder.paymentLinkId}` : "Please try again."}` },
            },
            { headers: { Authorization: `Bearer ${process.env.ACCESS_TOKEN}` } }
          );
        }
        return res.sendStatus(200);
      }
      // SAMPLE: If user types 'hi' → send product list
if (text.trim().toLowerCase() === "hi") {
  const products = await Product.find({});
  const phoneNumberId = tenant?.phoneNumberId || process.env.PHONE_NUMBER_ID;
  await sendProductList(userPhone,products,phoneNumberId);

  return res.sendStatus(200);
}

// SAMPLE: Detect BUY Command
if (text.toLowerCase().startsWith("buy")) {
  const productIndex = parseInt(text.split(" ")[1]) - 1;

  const products = await Product.find({});
  const product = products[productIndex];

  if (!product) {
    await sendMessage(userPhone, tenantPhoneId, "Invalid product number.");
    return res.sendStatus(200);
  }

  // Create a sample order via commerce route
  const orderResp = await axios.post(
    "https://crm-backend-c54a.onrender.com/api/v1/commerce/order",
    {
      phone: userPhone,
      tenantId: tenant._id,
      items: [
        {
          name: product.name,
          price: product.price,
          qty: 1,
        },
      ],
    }
  );

  return res.sendStatus(200);
}



      // Detect Payment Confirmation
if (text.trim().toLowerCase() === "done") {
  console.log("done part ")
  const pendingOrder = await Order.findOne({ phone: userPhone, status: "pending" })
    .sort({ createdAt: -1 });

  if (pendingOrder) {
    pendingOrder.status = "paid";
    await pendingOrder.save();

    await axios.post(
      `https://graph.facebook.com/v20.0/${tenantPhoneId}/messages`,
      {
        messaging_product: "whatsapp",
        to: userPhone,
        type: "text",
        text: { body: "✅ Payment Received! Your order is confirmed." },
      },
      {
        headers: { Authorization: `Bearer ${process.env.ACCESS_TOKEN}` },
      }
    );
  }
}


    // === Save Message with Contact ID ===
    const message = await Message.create({
      tenantId,
      contact: contact._id, // ← Critical for populate
      from: userPhone,
      to: tenantPhoneId,
      message: text,
      direction: "inbound",
      status: "delivered",
      timestamp: new Date(),
    });

    // === Emit to tenant room ===
    io.to(`tenant_${tenantId}`).emit("newMessage", message);

    // === Flow Logic ===
    const waitingRun = await FlowRun.findOne({
      userPhone,
      tenantId,
      status: "waiting",
    }).sort({ updatedAt: -1 });

    if (waitingRun) {
      if (msg.interactive?.button_reply?.id) {
        await continueFlowByUserReply(userPhone, msg.interactive.button_reply.id);
      } else {
        await continueFlowByUserReply(userPhone, text);
      }
      return res.sendStatus(200);
    }

    const incomingLower = text.trim().toLowerCase();
    const flows = await Flow.find({
      tenantId,
      isActive: true,
      "triggers.keywords": { $exists: true, $ne: [] },
    });

    for (const flow of flows) {
      if (flow.triggers.keywords.some(kw => incomingLower === kw.toLowerCase())) {
        await startFlow(flow._id, userPhone);
        return res.sendStatus(200);
      }
    }

    if (tenant.defaultFlowId) {
      await startFlow(tenant.defaultFlowId, userPhone);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err);
    res.sendStatus(500);
  }
});

// === Socket.io: Per-Tenant Rooms + Typing ===
const typingStatus = new Map(); // tenantId → userPhone → { typing, lastSeen }

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("joinTenant", (tenantId) => {
    socket.join(`tenant_${tenantId}`);
    console.log(`Socket ${socket.id} joined tenant_${tenantId}`);
  });

  socket.on("typing", ({ tenantId, userPhone }) => {
    const room = `tenant_${tenantId}`;
    if (!typingStatus.has(tenantId)) typingStatus.set(tenantId, {});
    typingStatus.get(tenantId)[userPhone] = { typing: true, lastSeen: new Date() };
    io.to(room).emit("typingUpdate", typingStatus.get(tenantId));
  });

  socket.on("stopTyping", ({ tenantId, userPhone }) => {
    const room = `tenant_${tenantId}`;
    const tenantTyping = typingStatus.get(tenantId);
    if (tenantTyping?.[userPhone]) {
      tenantTyping[userPhone] = { typing: false, lastSeen: new Date() };
      io.to(room).emit("typingUpdate", tenantTyping);
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

// === Start Server ===
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
// utils/whatsapp.js or at bottom of server.js
export const sendProductList = async (userPhone, products, tenantPhoneId) => {
  // CRITICAL: Clean the product objects + fix fields
  const cleanProducts = products.map(p => ({
    _id: p._id.toString(),
    name: (p.name || "Unnamed Product").slice(0, 20),
    price: p.price || 0,
    description: p.description || "No description",
  }));

  const payload = {
    messaging_product: "whatsapp",
    to: userPhone,
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: "RegalMints Store" },
      body: { text: "Choose your favourite product" },
      footer: { text: "Secure Payment – Fast Delivery" },
      action: {
        button: "View Products",
        sections: [
          {
            title: "Available Items",
            rows: cleanProducts.map(p => ({
              id: `BUY_${p._id}`,
              title: p.name,
              description: `₹${p.price} • ${p.description.slice(0, 55)}`,
            })),
          },
        ],
      },
    },
  };

  return axios.post(
    `https://graph.facebook.com/v24.0/${tenantPhoneId}/messages`,
    payload,
    {
      headers: { Authorization: `Bearer ${process.env.ACCESS_TOKEN}` },
    }
  );
};