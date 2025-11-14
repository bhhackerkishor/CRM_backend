import mongoose from "mongoose";

const orderSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant" },
  userPhone: String,
  items: [{ productId: mongoose.Schema.Types.ObjectId, qty: Number, price: Number }],
  total: Number,
  currency: String,
  status: { type: String, default: "pending" },
  paymentLink: String,
  paymentProviderId: String, // Razorpay order id etc.
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("Order", orderSchema);
