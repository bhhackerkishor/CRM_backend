import mongoose from "mongoose";

const tenantSchema = new mongoose.Schema({
  businessName: { type: String, required: true },
  whatsappNumber: { type: String, unique: true, sparse: true },
  phoneNumberId: {type:String,required:true},
  accessToken: {type:String ,required:true},
  metaAppId: {type:String ,required:true},
  plan: { type: String, enum: ["free", "startup", "growth", "enterprise"], default: "free" },
  status: { type: String, enum: ["active", "suspended", "cancelled"], default: "active" },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("Tenant", tenantSchema);