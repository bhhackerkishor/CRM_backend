// models/Message.js
import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true },
  contact: { type: mongoose.Schema.Types.ObjectId, ref: "Contact" }, // ← Must exist
  from: { type: String, required: true },
  to: { type: String, required: true },
  message: { type: String, required: true },
  direction: { type: String, enum: ["inbound", "outbound"], required: true },
  whatsappMessageId: String,
  status: { type: String, enum: ["sent", "delivered", "read"], default: "delivered" },
  timestamp: { type: Date, default: Date.now },
  agent: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
});

// ← Add this line to disable strict populate
messageSchema.set("strictPopulate", false);

export default mongoose.model("Message", messageSchema);