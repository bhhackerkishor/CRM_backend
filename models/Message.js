import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant" },
  contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact" },
  from: String,
  to: String,
  message: String,
  direction: { type: String, enum: ["inbound", "outbound"] },
  status: { type: String, enum: ["sent", "delivered", "read", "failed"], default: "sent" },
  timestamp: { type: Date, default: Date.now },
});
export default mongoose.model("Message", messageSchema);
