import mongoose from "mongoose";

const flowRunSchema = new mongoose.Schema({
  flowId: { type: mongoose.Schema.Types.ObjectId, ref: "Flow" },
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant" },
  userPhone: String,
  currentNodeId: String,
  status: { type: String, enum: ["queued","running","waiting","finished","failed"], default: "queued" },
  context: { type: Object, default: {} }, // variables, cart, payload...
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model("FlowRun", flowRunSchema);
