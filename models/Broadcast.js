// src/models/Broadcast.js
import mongoose from "mongoose";

const broadcastSchema = new mongoose.Schema({
  tenant: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true },
  name: { type: String, required: true },
  template: { type: mongoose.Schema.Types.ObjectId, ref: "Template", required: true },
  segment: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
  }, // e.g., { tags: ["vip"] }
  sentTo: { type: Number, default: 0 },
  delivered: { type: Number, default: 0 },
  failed: { type: Number, default: 0 },
  status: { type: String, enum: ["draft", "scheduled", "sent", "failed"], default: "draft" },
  scheduledAt: Date,
  sentAt: Date,
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("Broadcast", broadcastSchema);