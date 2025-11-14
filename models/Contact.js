// src/models/Contact.js
import mongoose from "mongoose";

const contactSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true },
  name: { type: String },
  phone: { type: String, required: true },
  email: String,
  tags: [String],
  customFields: { type: Map, of: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model("Contact", contactSchema);