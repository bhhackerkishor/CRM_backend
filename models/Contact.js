import mongoose from "mongoose";

const contactSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant" },
    name: String,
    phone: { type: String, unique: true },
    tags: [String],
    lastMessage: String,
    lastSeen: Date,
  });
  export default mongoose.model("Contact", contactSchema);
  