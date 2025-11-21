// routes/commerce.js
import express from "express";
import axios from "axios";
import Razorpay from "razorpay";
import Product from "../models/Product.js";
import Order from "../models/Order.js";
import dotenv from "dotenv";
import crypto from "crypto";

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
  console.log("Incoming Order Request:", req.body);
console.log("Razorpay Credentials:", process.env.RAZORPAY_KEY_ID, process.env.RAZORPAY_KEY_SECRET ? "exists" : "missing");

  try {
    const { phone, items, tenantId } = req.body;
    const amount = items.reduce((total, i) => total + (i.price * i.qty), 0);

    const paymentLink = await razor.paymentLink.create({
      amount: amount * 100,
      currency: "INR",
      customer: { contact: phone },
      description: "Order Payment",
      notify: { sms: true, email: false }
    });
    

    const order = await Order.create({
      phone,
      items,
      amount,
      tenantId,
      razorpayOrderId: paymentLink.order_id,
      status: "pending",
    });

    await axios.post(
      `https://graph.facebook.com/v20.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: phone,
        type: "text",
        text: {
          body: `🛒 Your Total: ₹${amount}\nClick below to pay securely 👇\n${paymentLink.short_url}\n\nReply DONE after payment.`,
        },
      },
      { headers: { Authorization: `Bearer ${process.env.ACCESS_TOKEN}` } }
    );

    res.json({ success: true, order });
  } catch (err) {
    
    console.log("Order error:", err);
    res.status(500).json({ error: "Failed to create order" });
  }
});


export const razorpayWebhook = async (req, res) => {
  console.log("🔔 [WEBHOOK RECEIVED]");
  console.log("Headers:", req.headers);
  console.log("Body:", JSON.stringify(req.body, null, 2));

  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const signature = req.headers["x-razorpay-signature"];
  const body = JSON.stringify(req.body);

  console.log("🔍 Calculating signature...");
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
  console.log("Expected Signature:", expected);
  console.log("Received Signature:", signature);

  // 🔐 Signature verification
  if (expected !== signature) {
    console.log("❌ Signature mismatch — webhook rejected");
    return res.status(403).json({ message: "Invalid signature" });
  }
  console.log("✅ Signature verified successfully");

  try {
    const event = req.body;
    console.log("Webhook Event:", event.event);

    // ▶ Payment captured
    if (event.event === "payment.captured") {
      console.log("💰 Payment Captured Event Triggered");

      const paymentId = event.payload.payment.entity.id;
      const amount = event.payload.payment.entity.amount / 100;
      const orderId = event.payload.payment.entity.order_id;

      console.log("Payment ID:", paymentId);
      console.log("Order ID:", orderId);
      console.log("Amount:", amount);

      // Fetch order
      const order = await Order.findOne({ razorpayOrderId: orderId });
      console.log("Order Found:", order ? order._id : "❌ No");

      if (!order) {
        console.log("⚠ Order not found in DB");
        return res.status(200).json({ message: "Order not found" });
      }

      // Update order in database
      order.status = "paid";
      order.paymentId = paymentId;
      await order.save();
      console.log("💾 Order updated to PAID");

      // Send WhatsApp Message
      try {
        await axios.post(
          `https://graph.facebook.com/v20.0/${process.env.PHONE_NUMBER_ID}/messages`,
          {
            messaging_product: "whatsapp",
            to: order.phone,
            type: "text",
            text: {
              body: `🎉 *Payment Successful!* \n\n💰 Amount: ₹${amount}\n🧾 Order ID: ${order._id}\n\nYour order has been confirmed. Thank you for shopping with us! 🙌`,
            },
          },
          { headers: { Authorization: `Bearer ${process.env.ACCESS_TOKEN}` } }
        );
        console.log("📨 WhatsApp confirmation sent");
      } catch (waErr) {
        console.log("⚠ WhatsApp Sending Error:", waErr?.response?.data || waErr);
      }
    }

    console.log("🏁 Webhook flow completed");
    res.status(200).json({ message: "Webhook received" });

  } catch (err) {
    console.log("🔥 Webhook error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

router.post("/webhook", express.json({ verify: false }), razorpayWebhook);

export default router;
