import mongoose from "mongoose";

const tenantSchema = new mongoose.Schema({
    businessName: String,
    whatsappNumber: String,
    accessToken: String,
    phoneNumberId: String,
    plan: { type: String, default: "free" },
  });
  export default mongoose.model("Tenant", tenantSchema);
  