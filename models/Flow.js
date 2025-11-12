import mongoose from "mongoose";

const flowSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant" },
  name: { type: String, required: true },
  description: String,
  nodes: { type: Array, default: [] }, // nodes from react-flow
  edges: { type: Array, default: [] }, // edges from react-flow
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("Flow", flowSchema);
