import mongoose from "mongoose";

const tenantSchema = new mongoose.Schema({
  businessName: { type: String, required: true },
  whatsappNumber: { type: String, unique: true, sparse: true },

  // These are optional until onboarding
  phoneNumberId: { type: String },
  accessToken: { type: String },
  metaAppId: { type: String },

  plan: { type: String, enum: ["free", "startup", "growth", "enterprise"], default: "free" },
  status: { 
    type: String, 
    enum: ["pending", "active", "suspended", "cancelled"], 
    default: "pending" 
  },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("Tenant", tenantSchema);