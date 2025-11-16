// routes/commerce.js
import express from "express";
import axios from "axios";
import Razorpay from "razorpay";
import Product from "../models/Product.js";
import Order from "../models/Order.js";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

// Razorpay Instance
const razor = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// === 1. GET All Products ===
router.get("/products", async (req, res) => {
  const products = await Product.find({});
  res.json(products);
});

// === 2. CREATE ORDER + SEND PAYMENT LINK ===
router.post("/order", async (req, res) => {
  try {
    const { phone, items, tenantId } = req.body;

    // Calculate amount
    const amount = items.reduce((total, i) => total + (i.price * i.qty), 0);

    // Create Razorpay order
    const rpOrder = await razor.orders.create({
      amount: amount * 100,
      currency: "INR",
      receipt: "order_rcptid_" + Date.now(),
    });

    // Save order in DB
    const order = await Order.create({
      phone,
      items,
      amount,
      tenantId,
      razorpayOrderId: rpOrder.id,
      status: "pending",
    });

    // Send WhatsApp payment link
    await axios.post(
      `https://graph.facebook.com/v20.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: phone,
        type: "text",
        text: {
          body: `🛒 Your Order Total: ₹${amount}\nPay securely using this link:\nhttps://rzp.io/i/${rpOrder.id}\n\nReply *DONE* after payment.`,
        },
      },
      {
        headers: { Authorization: `Bearer ${process.env.ACCESS_TOKEN}` },
      }
    );

    res.json({ success: true, order });
  } catch (err) {
    console.log("Order error:", err);
    res.status(500).json({ error: "Failed to create order" });
  }
});

export default router;
