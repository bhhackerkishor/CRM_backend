import express from "express";
import axios from "axios";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import cors from "cors";


import mongoose from "mongoose";
// models
import Message from "./models/Message.js"; // import the model

dotenv.config();
const app = express();
app.use(bodyParser.json());
app.use(cors());


// ✅ MongoDB connection

mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ MongoDB Connection Error:", err));




// ✅ Test route
app.get("/", (req, res) => {
  res.send("RegalMints CRM WhatsApp Backend Running 🚀");
});

// ✅ Send Message route
app.post("/api/send-message", async (req, res) => {
  try {
    const { to, message } = req.body;
    console.log(req.body);

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
    direction: "out",
    status: "sent",
  });
  io.emit("newMessage", saved);
  
    console.log(response.data)

    res.status(200).json({ success: true, data: response.data });
  } catch (error) {
    console.error("Error sending message:", error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ Webhook verification (for incoming messages)
app.post("/api/webhook", async (req, res) => {
    try {
      const data = req.body;
      console.log("Incoming message:", JSON.stringify(req.body, null, 2));
  
      if (data.object && data.entry?.[0]?.changes?.[0]?.value?.messages) {
        const messageInfo = data.entry[0].changes[0].value.messages[0];
        const from = messageInfo.from;
        const text = messageInfo.text?.body || "non-text message";
  
        console.log("📩 New message from:", from, "→", text);
  
        
        const newMsg = await Message.create({
            from,
            to: process.env.PHONE_NUMBER_ID,
            message: text,
            direction: "in",
            status: "delivered",
          });
          io.emit("newMessage", newMsg);          
        
        
        
      }
  
      res.sendStatus(200);
    } catch (err) {
      console.error("❌ Webhook error:", err.message);
      res.sendStatus(500);
    }
  });



app.get("/api/messages", async (req, res) => {
    try {
      const messages = await Message.find().sort({ timestamp: -1 });
      res.json(messages);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  

app.listen(process.env.PORT, () =>
  console.log(`🚀 Server running on http://localhost:${process.env.PORT}`)
);
