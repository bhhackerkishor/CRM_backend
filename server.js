// server.js
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";


import connectDB from "./config/db.js";
import authRoutes from "./routes/auth.js";
import tenantRoutes from "./routes/tenant.js";
import contactRoutes from "./routes/contact.js";
import templateRoutes from "./routes/template.js";
import broadcastRoutes from "./routes/broadcast.js";
import messageRoutes from "./routes/message.js";
import flowRoutes from "./routes/flowRoutes.js";

import { startScheduler } from "./services/scheduler.js";
import { startFlow, continueFlowByUserReply } from "./utils/flowRunner.js";

import Message from "./models/Message.js";
import Contact from "./models/Contact.js";
import Tenant from "./models/Tenant.js";
import Flow from "./models/Flow.js";
import FlowRun from "./models/FlowRun.js";



// server.js (top, after io creation)
import { attachIo } from "./middleware/attachIo.js";


dotenv.config();
startScheduler();

// === App Setup ===
const app = express();


// HTTP + Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
  path: "/socket.io",
});


// ==== FIXED CORS (Render Safe) ====
const allowedOrigins = [
  "http://localhost:3000",
  "https://your-frontend.vercel.app"
];

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  }

  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});

// Keep cors() but simpler
app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

app.use(bodyParser.json());



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