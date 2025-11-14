// src/models/Template.js
import mongoose from "mongoose";

const templateSchema = new mongoose.Schema({
  tenant: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true },
  name: { type: String, required: true },
  templateId: { type: String, required: true }, // WhatsApp template ID
  language: { type: String, default: "en" },
  variables: [String], // e.g., ["name", "order_id"]
  body: String,
  status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("Template", templateSchema);