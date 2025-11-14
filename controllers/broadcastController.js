// src/controllers/broadcastController.js
import Broadcast from "../models/Broadcast.js";
import Template from "../models/Template.js";
import Contact from "../models/Contact.js";
import { sendWhatsAppMessage } from "../services/whatsapp.js"; // We'll create this

export const createBroadcast = async (req, res) => {
  const { name, templateId, segment } = req.body;
  const broadcast = await Broadcast.create({
    tenant: req.tenantId,
    name,
    template: templateId,
    segment,
  });
  res.status(201).json(broadcast);
};

export const sendBroadcast = async (req, res) => {
  const broadcast = await Broadcast.findOne({ _id: req.params.id, tenant: req.tenantId });
  if (!broadcast) return res.status(404).json({ message: "Not found" });

  const template = await Template.findById(broadcast.template);
  const contacts = await Contact.find({
    tenant: req.tenantId,
    ...Object.fromEntries(
      Object.entries(broadcast.segment.toObject()).map(([k, v]) => [
        k,
        Array.isArray(v) ? { $in: v } : v,
      ])
    ),
  });

  let sent = 0, failed = 0;
  for (const contact of contacts) {
    try {
      const variables = template.variables.reduce((acc, v, i) => {
        acc[v] = contact.customFields?.get(v) || contact.name || "Customer";
        return acc;
      }, {});
      await sendWhatsAppMessage(contact.phone, template.templateId, variables);
      sent++;
    } catch (err) {
      failed++;
    }
  }

  broadcast.sentTo = contacts.length;
  broadcast.delivered = sent;
  broadcast.failed = failed;
  broadcast.status = "sent";
  broadcast.sentAt = new Date();
  await broadcast.save();

  res.json(broadcast);
};

export const getBroadcasts = async (req, res) => {
  const broadcasts = await Broadcast.find({ tenant: req.tenantId })
    .populate("template", "name")
    .sort({ createdAt: -1 });
  res.json(broadcasts);
};