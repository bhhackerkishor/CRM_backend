// routes/commerce.js
import express from "express";
import Razorpay from "razorpay";
import Product from "../models/Product.js";
import Order from "../models/Order.js";
import dotenv from "dotenv";
import crypto from "crypto";
import axios from "axios";
import Tenant from "../models/Tenant.js"
dotenv.config();

const router = express.Router();

// Razorpay Instance
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// === 1. GET All Products ===
router.get("/products", async (req, res) => {
  try {
    const products = await Product.find({ tenantId: req.query.tenantId || null });
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === 2. CREATE ORDER + SEND PAYMENT LINK ===
router.post("/order", async (req, res) => {
  try {
    const { phone, items, tenantId } = req.body;
    if (!phone || !items?.length || !tenantId) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const amount = items.reduce((t, i) => t + i.price * i.qty, 0);

    // 1. Save order first
    const order = await Order.create({
      phone,
      items,
      amount,
      tenantId,
      status: "pending",
    });

    // 2. Create Razorpay payment link
    const paymentLink = await razorpay.paymentLink.create({
      amount: amount * 100,
      currency: "INR",
      description: `Order #${order._id}`,
      customer: { contact: phone },
      notify: { sms: true, whatsapp: false },
      notes: {
        localOrderId: order._id.toString(),
        tenantId: tenantId.toString(),
        phone,
      },
    });

    // 3. Update order with Razorpay IDs
    order.paymentLinkId = paymentLink.id;
    order.razorpayOrderId = paymentLink.order_id;
    await order.save();

    // 4. Get tenant's phone_number_id
    const tenant = await Tenant.findById(tenantId);
    const phoneNumberId = tenant?.phoneNumberId || process.env.PHONE_NUMBER_ID;

    // 5. Build pretty message
    const itemsText = items
      .map(i => `• ${i.name} × ${i.qty} = ₹${i.price * i.qty}`)
      .join("\n");

    // ---- REPLY BUTTON (no url field) ----
    await axios.post(
      `https://graph.facebook.com/v24.0/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        to: phone,
        type: "interactive",
        interactive: {
          type: "button",
          body: {
            text: `*Order Summary*\n\n${itemsText}\n\n*Total: ₹${amount}*\n\nTap **Pay Now** to complete payment.`,
          },
          action: {
            buttons: [
              {
                type: "reply",  // ← THIS IS THE ONLY VALID TYPE
                reply: {
                  id: "PAY_NOW",
                  title: `Pay ₹${amount}`,
                },
              },
            ],
          },
          footer: { text: "Secure payment – Razorpay" },
        },
      },
      { headers: { Authorization: `Bearer ${process.env.ACCESS_TOKEN}` } }
    );

    // ---- SEND SHORT URL AS PLAIN TEXT (clickable) ----
    await axios.post(
      `https://graph.facebook.com/v24.0/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        to: phone,
        type: "text",
        text: { body: paymentLink.short_url },
      },
      { headers: { Authorization: `Bearer ${process.env.ACCESS_TOKEN}` } }
    );

    return res.json({ success: true, order, paymentLink: paymentLink.short_url });
  } catch (err) {
    console.error("Order error:", err.response?.data || err);
    return res.status(500).json({ error: "Failed to create order" });
  }
});

// === Razorpay Webhook ===
export const razorpayWebhook = async (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const signature = req.headers["x-razorpay-signature"];

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(JSON.stringify(req.body))
    .digest("hex");

  if (expectedSignature !== signature) {
    console.log("Invalid webhook signature");
    return res.status(400).json({ error: "Invalid signature" });
  }

  const event = req.body;

  if (event.event === "payment.captured") {
    const payment = event.payload.payment.entity;
    const paymentId = payment.id;
    const amount = payment.amount / 100;

    let order = null;

    // Priority 1: Match by localOrderId in notes (100% reliable)
    if (payment.notes?.localOrderId) {
      order = await Order.findById(payment.notes.localOrderId);
    }

    // Priority 2: Fallback to order_id
    if (!order && payment.order_id) {
      order = await Order.findOne({ razorpayOrderId: payment.order_id });
    }

    // Priority 3: Fallback to payment link ID
    if (!order && payment.description) {
      const plink = payment.description.replace(/^#/, "");
      if (plink.startsWith("plink_")) {
        order = await Order.findOne({ paymentLinkId: plink });
      }
    }

    if (!order) {
      console.log("Order not found for payment:", paymentId);
      return res.status(200).json({ status: "unmatched_payment" });
    }

    // Update order
    order.status = "paid";
    order.paymentId = paymentId;
    order.paidAt = new Date();
    await order.save();

    console.log(`Order ${order._id} marked as PAID`);

    // Send Confirmation Message
    const tenant = await import("../models/Tenant.js").then(m => m.default.findById(order.tenantId));
    const phoneNumberId = tenant?.phoneNumberId || process.env.PHONE_NUMBER_ID;

    const itemsText = order.items.map(i => `• ${i.name} × ${i.qty}`).join("\n");

    try {
      await axios.post(
        `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
        {
          messaging_product: "whatsapp",
          to: order.phone,
          type: "text",
          text: {
            body: `Payment Successful!\n\n*Order Confirmed*\nOrder ID: ${order._id}\nAmount: ₹${amount}\n\n*Items:*\n${itemsText}\n\nThank you for your purchase! Your order is being processed.\nWe'll notify you when it's shipped.`,
          },
        },
        { headers: { Authorization: `Bearer ${process.env.ACCESS_TOKEN}` } }
      );
    } catch (waErr) {
      console.log("Failed to send confirmation:", waErr.response?.data || waErr.message);
    }
  }

  res.status(200).json({ status: "ok" });
};

// Webhook Route
router.post("/webhook", express.raw({ type: "application/json" }), razorpayWebhook);

export default router;