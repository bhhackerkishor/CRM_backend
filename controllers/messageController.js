// src/controllers/messageController.js
import Message from "../models/Message.js";
import Contact from "../models/Contact.js";
import Tenant from "../models/Tenant.js";

export const getMessages = async (req, res) => {
    
  const messages = await Message.find({ tenantId: req.tenantId })
    .populate("contact", "name phone")
    .sort({ timestamp: 1 });
  res.json(messages);
  
};

export const sendMessage = async (req, res) => {
    const { to, message } = req.body;
    const tenantId = req.user.tenantId; // assuming auth middleware sets req.user
  
    try {
      const tenant = await Tenant.findById(tenantId);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
  
      // Find or create contact
      let contact = await Contact.findOne({ phone: to, tenantId });
      if (!contact) {
        contact = await Contact.create({
          tenantId,
          phone: to,
          name: to,
          source: "manual",
        });
      }
  
      // Send to WhatsApp
      const waRes = await require("axios").default.post(
        `https://graph.facebook.com/v20.0/${tenant.phoneNumberId}/messages`,
        {
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: message },
        },
        { headers: { Authorization: `Bearer ${tenant.accessToken}` } }
      );
  
      // Save message
      const savedMsg = await Message.create({
        tenantId,
        contact: contact._id,
        from: tenant.whatsappNumber,
        to,
        message,
        direction: "outbound",
        whatsappMessageId: waRes.data.messages[0].id,
        status: "sent",
        timestamp: new Date(),
      });
  
      // Populate contact for frontend
      await savedMsg.populate("contact", "name phone");
  
      // Emit to tenant room
      req.io.to(`tenant_${tenantId}`).emit("newMessage", savedMsg);
      console.log(req.io)
  
      res.json(savedMsg);
    } catch (err) {
      console.error("Send message error:", err);
      res.status(500).json({ error: err.message });
    }
}