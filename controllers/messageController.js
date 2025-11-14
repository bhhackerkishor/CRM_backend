// src/controllers/messageController.js
import Message from "../models/Message.js";
import Contact from "../models/Contact.js";
import Tenant from "../models/Tenant.js";

import axios from "axios";

export const getMessages = async (req, res) => {
    
  const messages = await Message.find({ tenantId: req.tenantId })
    .populate("contact", "name phone")
    .sort({ timestamp: 1 });
  res.json(messages);
  
};

export const sendMessage = async (req, res) => {
  const { to, message } = req.body;
  console.log(req.body)
  const tenant = await Tenant.findById(req.tenantId);

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: message },
  };

  try {
    const waRes = await axios.post(
      `https://graph.facebook.com/v20.0/${tenant.phoneNumberId}/messages`,
      payload,
      { headers: { Authorization: `Bearer ${tenant.accessToken}` } }
    );
    

    const msg = await Message.create({
      tenant: req.tenantId,
      from: tenant.whatsappNumber,
      to,
      message,
      direction: "outbound",
      whatsappMessageId: waRes.data.messages[0].id,
    });

    req.io.to(`tenant_${req.tenantId}`).emit("newMessage", msg);
    res.json(msg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};