import mongoose from "mongoose";

const orderSchema = new mongoose.Schema({
  phone: String,
  items: Array,
  amount: Number,
  tenantId: mongoose.Schema.Types.ObjectId,
  razorpayOrderId: String,
  status: {
    type: String,
    default: "pending",
  },
});

export default mongoose.model("Order", orderSchema);
