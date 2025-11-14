import express from "express";
import axios from "axios";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import cors from "cors";
import mongoose from "mongoose";
import http from "http";           // ✅ Needed for socket.io
import { Server } from "socket.io";
//models
import Message from "./models/Message.js";
import Flow from "./models/Flow.js";
import FlowRun from "./models/FlowRun.js";
import Contact from "./models/Contact.js";
import Tenant from "./models/Tenant.js";




//routes
import flowRoutes from "./routes/flowRoutes.js";
import { startFlow,continueFlowByUserReply} from "./utils/flowRunner.js";
//import flowData from "./sampleFlow.json" assert { type: "json" }; // export your flow as JSON
import connectDB from "./config/db.js";
import authRoutes from "./routes/auth.js";
import tenantRoutes from "./routes/tenant.js";
import { startScheduler } from "./services/scheduler.js";
import contactRoutes from "./routes/contact.js";
import broadcastRoutes from "./routes/broadcast.js";
import templateRoutes from "./routes/template.js";





//node-crn to check the sheduled flows or msg
startScheduler();
dotenv.config();
const app = express();
app.use(bodyParser.json());
app.use(cors());

// ✅ Create HTTP + Socket server
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // adjust to your frontend origin in production
    methods: ["GET", "POST"],
  },
});

// ✅ MongoDB connection
connectDB();

// ✅ Test route
app.get("/", (req, res) => {
  res.send("ChatCom (RegalMints CRM) Backend Running 🚀");
});

app.post("/api/run-flow", async (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: "Missing phone number" });
  try {
    const tenent=1244
    await runFlowById(to,tenent);
    res.json({ success: true, message: "Flow triggered successfully" });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});
//  Routes

app.use("/api/v1/flows", flowRoutes);
app.use("/api/v1/contacts", contactRoutes);
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/tenants", tenantRoutes);
app.use("/api/v1/templates", templateRoutes);
app.use("/api/v1/broadcasts", broadcastRoutes);



app.post('/api/broadcast', async (req, res) => {
  const { message, to } = req.body;

  if (!message || !to) {
    return res.status(400).json({ error: 'Message and recipients required' });
  }

  const recipients = to.split(',').map(num => num.trim().replace(/^\+/, '')); // Clean numbers
  const results = [];

  for (const recipient of recipients) {
    try {
      const response = await axios.post(
        `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: 'whatsapp',
          to: recipient,
          type: 'text',
          text: { body: message }
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );
      results.push({ recipient, status: 'sent', messageId: response.data.messages[0].id });
    } catch (error) {
      results.push({ recipient, status: 'failed', error: error.response?.data?.error?.message || error.message });
    }
  }

  res.json({ results, total: recipients.length, success: results.filter(r => r.status === 'sent').length });
});

// ✅ Send WhatsApp Message
app.post("/api/send-message", async (req, res) => {
  try {
    const { to, message } = req.body;

    const response = await axios.post(
      `https://graph.facebook.com/v20.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: message },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
// inside /api/send-message
const saved = await Message.create({
    from: process.env.PHONE_NUMBER_ID, // your business ID
    to,
    message,
    direction: "outbound",
    status: "sent",
  });
  

    // ✅ Emit event to all clients (real-time)
    io.emit("newMessage", saved);

    res.status(200).json({ success: true, data: saved });
  } catch (error) {
    console.error("Error sending message:", error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ Webhook Verification
app.get("/api/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token && mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified successfully!");
    res.status(200).send(challenge);
  } else {
    console.log("❌ Verification failed.");
    res.sendStatus(403);
  }
});

// ✅ Webhook Receiver
app.post("/api/webhook", async (req, res) => {
  try {
    const data = req.body;
    console.log("WEBHOOK GOT:", JSON.stringify(data, null, 2));

    // Ensure valid WA event
    if (!data.entry?.[0]?.changes?.[0]?.value) return res.sendStatus(200);

    const value = data.entry[0].changes[0].value;
    const messages = value.messages;
    const contacts = value.contacts;
    if (!messages || messages.length === 0) return res.sendStatus(200);

    const msg = messages[0];

    const userPhone = msg.from;
    const tenantPhoneNumberId = value.metadata?.phone_number_id;

    const tenant = await Tenant.findOne({ phoneNumberId: tenantPhoneNumberId });
    if (!tenant) return res.sendStatus(200);

    const tenantId = tenant._id;
    const profileName =
      msg?.profile?.name || contacts?.[0]?.profile?.name || "";

    // Upsert contact
    await Contact.findOneAndUpdate(
      { phone: userPhone, tenantId },
      { name: profileName, lastIncomingAt: new Date(), source: "whatsapp" },
      { upsert: true }
    );

    // Extract message text
    const text =
      msg.text?.body ||
      msg.interactive?.button_reply?.title ||
      "non-text message";

    await Message.create({
      tenantId,
      from: userPhone,
      to: tenantPhoneNumberId,
      message: text,
      direction: "inbound",
      status: "delivered",
      timestamp: new Date(),
    });

    // -------------------------------------------------------
    // 🔥 1. IF FLOW IS WAITING → CONTINUE IT
    // -------------------------------------------------------

    const waitingRun = await FlowRun.findOne({
      userPhone,
      tenantId,
      status: "waiting",
    }).sort({ updatedAt: -1 });

    if (waitingRun) {
      console.log("📌 Continuing waiting flow...");

      // BUTTON REPLY
      if (msg.interactive?.button_reply?.id) {
        const replyId = msg.interactive.button_reply.id;
        await continueFlowByUserReply(userPhone, replyId);
      } else {
        // TEXT INPUT
        await continueFlowByUserReply(userPhone, text);
      }

      return res.sendStatus(200);
    }

    // -------------------------------------------------------
    // 🔥 2. KEYWORD TRIGGERED FLOWS
    // -------------------------------------------------------

    const incomingLower = (text || "").trim().toLowerCase();

    const flows = await Flow.find({
      tenantId,
      isActive: true,
      "triggers.keywords": { $exists: true, $ne: [] },
    });

    for (const flow of flows) {
      for (const kw of flow.triggers.keywords) {
        if (incomingLower === kw.toLowerCase()) {
          console.log("🟢 Running triggered flow:", flow.name);
          await startFlow(flow._id, userPhone);
          return res.sendStatus(200);
        }
      }
    }

    // -------------------------------------------------------
    // 🔥 3. DEFAULT FLOW
    // -------------------------------------------------------

    if (tenant.defaultFlowId) {
      console.log("🟡 Running default flow");
      await startFlow(tenant.defaultFlowId, userPhone);
      return res.sendStatus(200);
    }

    // -------------------------------------------------------
    // 4. Nothing matched
    // -------------------------------------------------------
    console.log("⚪ No flow triggered.");
    return res.sendStatus(200);
  } catch (err) {
    console.error("Webhook Error:", err);
    return res.sendStatus(500);
  }
});



// ✅ Get all messages
app.get("/api/messages", async (req, res) => {
  try {
    const messages = await Message.find().sort({ timestamp: 1 });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ Socket.io connections
const userActivity = {}; // track typing & last seen

io.on("connection", (socket) => {
  console.log("🟢 User connected:", socket.id);

  // Typing event
  socket.on("typing", (user) => {
    userActivity[user] = { typing: true, lastSeen: new Date() };
    io.emit("userActivity", userActivity);
  });

  socket.on("stopTyping", (user) => {
    userActivity[user] = { typing: false, lastSeen: new Date() };
    io.emit("userActivity", userActivity);
  });

  socket.on("disconnect", () => {
    console.log("🔴 User disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
);