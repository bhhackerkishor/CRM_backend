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

    const paymentLink = razor.paymentLink.create({
      amount: amount * 100,
      currency: "INR",
      customer: { contact: phone },
      description: "Order Payment",
      create_order: true,               // ← create a Razorpay order (order_xxx)
      notes: { localOrderId: String(localOrder._id) },
      notify: { sms: true, email: false, whatsapp: false }
    });
    
    console.log("paymentlink",paymentLink)
    const order = await Order.create({
      phone,
      items,
      amount,
      tenantId,
      paymentLinkId: paymentLink.id,         // plink_...
      razorpayOrderId: paymentLink.order_id, // order_...
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


// enhanced webhook
export const razorpayWebhook = async (req, res) => {
  console.log("🔔 [WEBHOOK RECEIVED]");
  console.log("Headers:", req.headers);
  console.log("Body:", JSON.stringify(req.body));

  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const signature = req.headers["x-razorpay-signature"];
  const expected = crypto.createHmac("sha256", secret).update(JSON.stringify(req.body)).digest("hex");

  if (expected !== signature) {
    console.log("❌ Invalid signature");
    return res.status(403).send("Invalid signature");
  }

  try {
    const event = req.body;
    if (event.event !== "payment.captured") {
      console.log("Ignored event:", event.event);
      return res.status(200).send("ignored");
    }

    const payment = event.payload.payment.entity;
    const paymentId = payment.id;
    const amount = payment.amount / 100;
    const orderId = payment.order_id;           // order_xxx (may be undefined for some flows)
    const description = payment.description || ""; // often "#plink_..."
    const contact = payment.contact || payment.vpa || payment.email;

    console.log({ paymentId, amount, orderId, description, contact });

    // 1) Try find by razorpayOrderId (order_xxx)
    let order = null;
    if (orderId) {
      order = await Order.findOne({ razorpayOrderId: orderId });
      console.log("Find by razorpayOrderId:", order ? "FOUND" : "NOT FOUND");
    }

    // 2) Try find by paymentLinkId if description contains #plink_...
    if (!order && description) {
      const possiblePlink = description.replace(/^#/, "").trim(); // strip leading #
      if (possiblePlink.startsWith("plink_")) {
        order = await Order.findOne({ paymentLinkId: possiblePlink });
        console.log("Find by paymentLinkId (from description):", order ? "FOUND" : "NOT FOUND");
      }
    }

    // 3) Try find by notes.localOrderId (if you stored notes when creating link)
    if (!order && payment.notes) {
      if (payment.notes.localOrderId) {
        order = await Order.findById(payment.notes.localOrderId);
        console.log("Find by notes.localOrderId:", order ? "FOUND" : "NOT FOUND");
      }
    }

    // 4) Fallback: match by phone + amount + pending order (last resort)
    if (!order) {
      const normalizedContact = (contact || "").replace(/\D/g, "");
      order = await Order.findOne({
        phone: new RegExp(normalizedContact.slice(-10) + "$"), // match last 10 digits
        amount,
        status: "pending",
      }).sort({ createdAt: -1 });
      console.log("Fallback match by phone+amount:", order ? "FOUND" : "NOT FOUND");
    }

    if (!order) {
      console.log("⚠ Unable to match payment to any order. PaymentId:", paymentId);
      // store the payment record in a separate collection for manual reconciliation
      // or call razor.paymentLink.fetch(description) to obtain the linked order_id
      return res.status(200).json({ message: "Order not found" });
    }

    // Update order
    order.status = "paid";
    order.paymentId = paymentId;
    await order.save();
    console.log("💾 Order updated to PAID:", order._id);

    // Send WhatsApp confirmation
    try {
      await axios.post(`https://graph.facebook.com/v20.0/${process.env.PHONE_NUMBER_ID}/messages`, {
        messaging_product: "whatsapp",
        to: order.phone,
        type: "text",
        text: {
          body: `🎉 Payment successful!\nOrder: ${order._id}\nAmount: ₹${amount}`,
        },
      }, { headers: { Authorization: `Bearer ${process.env.ACCESS_TOKEN}` }});
      console.log("📨 WhatsApp confirmation sent");
    } catch (waErr) {
      console.log("⚠ WhatsApp send error:", waErr?.response?.data || waErr.message);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.log("Webhook error", err);
    return res.status(500).json({ error: "server error" });
  }
};

router.post("/webhook", express.json({ verify: false }), razorpayWebhook);

export default router;
