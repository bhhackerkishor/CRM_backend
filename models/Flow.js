import mongoose from "mongoose";

const flowSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true },
  name: { type: String, required: true },
  description: String,
  nodes: { type: Array, default: [] },
  edges: { type: Array, default: [] },
  variables: [
    {
      key: String,     // e.g. "userName"
      label: String,   // e.g. "User Name"
      type: { type: String, enum: ["text", "number", "boolean", "cart", "order"], default: "text" },
      defaultValue: String,
    },
  ],
  
  active: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model("Flow", flowSchema);
