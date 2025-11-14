// models/Product.js
import mongoose from "mongoose";

const productSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant" },
  name: String,
  description: String,
  price: Number,
  currency: { type: String, default: "INR" },
  image: String,
  stock: { type: Number, default: 10 },
  category: String,
  tags: [String],
  active: { type: Boolean, default: true },
});

export default mongoose.model("Product", productSchema);
