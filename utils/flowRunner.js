import Flow from "../models/Flow.js";
import Tenant from "../models/Tenant.js";
import FlowRun from "../models/FlowRun.js";
import Message from "../models/Message.js";
import Product from "../models/Product.js";
import Cart from "../models/Cart.js";
import Order from "../models/Order.js";
import axios from "axios";
import mongoose from "mongoose";

async function sendText(tenant, to, text) {
  console.log(tenant, to, text)
  const res =await axios.post(`https://graph.facebook.com/v20.0/${tenant.phoneNumberId}/messages`, {
    messaging_product: "whatsapp", to, type: "text", text: { body: text }
  }, { headers: { Authorization:`Bearer ${tenant.accessToken}` } });

  console.log(res.data)

  await Message.create({ tenantId: tenant._id, from: tenant.phoneNumberId, to, message: text, direction: "outbound", status: "sent" });
}

async function sendInteractive(tenant, to, data) {
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      header: data.image ? { type: "image", image: { link: data.image } } : undefined,
      body: { text: data.title || "Choose an option" },
      action: { buttons: data.buttons.map((b,i)=>({ type:"reply", reply:{ id:`btn-${i}`, title:b } })) }
    }
  };
  await axios.post(`https://graph.facebook.com/v20.0/${tenant.phoneNumberId}/messages`, payload, { headers:{ Authorization:`Bearer ${tenant.accessToken}` }});
  await Message.create({ tenantId: tenant._id, from: tenant.phoneNumberId, to, message: data.title, direction: "outbound", status: "sent", media: data.image || null });
}

// Run a flow by id
export async function runFlowById(flowId, to) {
  // 1️⃣ Fetch flow and tenant
 // console.log("run1",to)
  const flow = await Flow.findById(flowId);
  if (!flow) throw new Error("Flow not found");
 // console.log("run2")
  const tenant = await Tenant.findById(flow.tenantId);
  if (!tenant) throw new Error("Tenant not found");
  //console.log("run")

  // 2️⃣ Create a FlowRun document
  const run = await FlowRun.create({
    flowId,
    tenantId: tenant._id,
    userPhone: to,
    status: "running",
    context: {},
  });

  // 3️⃣ Find the start node (first in flow or 'input')
  let current =
    flow.nodes.find((n) => n.type === "input") ||
    flow.nodes.find((n) => !flow.edges.some((e) => e.target === n.id));

  // 4️⃣ Loop through nodes sequentially
  while (current) {
    // Persist current node to FlowRun
    //console.log(current)
    run.currentNodeId = current.id;
    run.updatedAt = new Date();
    await run.save();

    // Execute node logic
    const result = await executeNode(flow, run, tenant, to, current);

    // Stop execution if node waits (like mediaButtons, wait, or order)
    if (result?.stop) return;

    // Find the next connected edge
    const nextEdge =
      result?.nextEdge ||
      flow.edges.find((e) => e.source === current.id && !e.sourceHandle);

    // Move to next node
    current = nextEdge
      ? flow.nodes.find((n) => n.id === nextEdge.target)
      : null;
  }

  // 5️⃣ Mark flow as finished
  run.status = "finished";
  await run.save();
}

 

// continue from button press
export async function continueFlowFromButton(tenantPhoneOrUser, replyId) {
  // tenantPhoneOrUser is user phone; need tenant mapping from phone used in webhook or find FlowRun waiting for that user
  const userPhone = tenantPhoneOrUser;
  // find the last FlowRun in waiting state for this user
  const run = await FlowRun.findOne({ userPhone, status: "waiting" }).sort({ updatedAt: -1 });
  if (!run) return;

  const flow = await Flow.findById(run.flowId);
  const tenant = await Tenant.findById(run.tenantId);

  // find edge with sourceHandle === replyId and source === run.context.waitingNodeId
  const matchingEdge = flow.edges.find(e => e.source === run.context.waitingNodeId && e.sourceHandle === replyId);
  if (!matchingEdge) {
    console.log("no matching edge for", replyId);
    return;
  }

  const nextNode = flow.nodes.find(n=>n.id === matchingEdge.target);
  if (!nextNode) return;

  run.currentNodeId = nextNode.id; run.status="running"; await run.save();

  if (nextNode.type === "message") {
    await sendText(tenant, userPhone, nextNode.data.label);
  } else if (nextNode.type === "mediaButtons") {
    await sendInteractive(tenant, userPhone, nextNode.data);
    run.status="waiting"; run.context.waitingNodeId = nextNode.id; await run.save(); return;
  } else if (nextNode.type === "create_order") {
    await createOrderAndSendPaymentLink(tenant, userPhone, nextNode.data);
    return;
  }

  // find next sequential and continue (you can loop — for brevity run only one step here)
  const nextEdge = flow.edges.find(e=>e.source === nextNode.id && !e.sourceHandle);
  if (nextEdge) {
    const seqNode = flow.nodes.find(n=>n.id === nextEdge.target);
    if (seqNode) {
      // recursively continue (or loop)
      run.currentNodeId = seqNode.id; await run.save();
      // handle seqNode as above...
    }
  }
}

// Example helper - add to cart
async function addToCart(tenantId, userPhone, productId, qty=1) {
  const prod = await Product.findById(productId);
  if (!prod) throw new Error("Product not found");
  let cart = await Cart.findOne({ tenantId, userPhone });
  if (!cart) {
    cart = await Cart.create({ tenantId, userPhone, items: [], total: 0 });
  }
  // add or increase
  const existing = cart.items.find(i=>i.productId.toString()===productId.toString());
  if (existing) existing.qty += qty;
  else cart.items.push({ productId: prod._id, qty, price: prod.price });
  cart.total = cart.items.reduce((s,i)=>s + i.qty * i.price, 0);
  cart.updatedAt = new Date();
  await cart.save();
}

// Example createOrder & send payment link (Razorpay)
import Razorpay from "razorpay"; // if installed
async function createOrderAndSendPaymentLink(tenant, userPhone, config) {
  // fetch cart
  const cart = await Cart.findOne({ tenantId: tenant._id, userPhone });
  if (!cart) {
    await sendText(tenant, userPhone, "Your cart is empty.");
    return;
  }

  // create order in DB
  const order = await Order.create({
    tenantId: tenant._id,
    userPhone,
    items: cart.items.map(i=>({ productId: i.productId, qty: i.qty, price: i.price })),
    total: cart.total,
    currency: "INR",
    status: "pending"
  });

  // Create payment link via Razorpay Orders or Payment Links API (example uses payment link creation)
  // You need Razorpay credentials per tenant (store in Tenant model)
  const rp = new Razorpay({ key_id: process.env.RAZOR_KEY, key_secret: process.env.RAZOR_SECRET });
  const paymentOrder = await rp.orders.create({
    amount: order.total * 100, // in paise
    currency: "INR",
    receipt: order._id.toString(),
    payment_capture: 1
  });

  order.paymentProviderId = paymentOrder.id;
  // prepare a payment link (you can use your frontend to accept payment using order id)
  const paymentLink = `${process.env.FRONTEND_URL}/pay?orderId=${order._id}`; 
  order.paymentLink = paymentLink;
  await order.save();

  // send message with button to open payment link
  const message = `Your order total is ₹${order.total}. Pay here: ${paymentLink}`;
  await sendText(tenant, userPhone, message);

  // clear cart if needed
  await Cart.deleteOne({ tenantId: tenant._id, userPhone });

  return order;
}
async function executeNode(flow, run, tenant, to, node) {
  console.log(node.type)
  switch (node.type) {
    case "message":
      await sendText(tenant, to, resolveVariables(node.data.label, run.context));
      break;

    case "mediaButtons":
      const newData = {
        ...node.data,
        title: resolveVariables(node.data.title, run.context),
      };
      await sendInteractive(tenant, to, newData);
      run.status = "waiting";
      run.context.waitingNodeId = node.id;
      run.context.waitingFor = "button_reply";
      await run.save();
      return { stop: true };

      case "condition":
  const result = evaluateCondition(node, run.context);
  const branch = result ? "true" : "false";
  const nextEdge = flow.edges.find(
    (e) => e.source === node.id && e.sourceHandle === branch
  );
  return { nextEdge };

    case "wait":
      const ms = node.data.ms || 2000;
      await new Promise((res) => setTimeout(res, ms));
      break;

    case "call_api":
      try {
        await axios.post(node.data.url, { user: to, ctx: run.context });
      } catch (err) {
        console.log("API call failed", err.message);
      }
      break;

    case "set_tag":
      run.context[node.data.key] = node.data.value;
      await run.save();
      break;
  }
  return {};
}
function resolveVariables(text, context) {
  if (!text || typeof text !== "string") return text;
  return text.replace(/\{\{(.*?)\}\}/g, (_, key) => {
    const value = key.trim().split('.').reduce((acc, k) => acc?.[k], context);
    return value !== undefined ? value : `{{${key}}}`;
  });
}
function evaluateCondition(node, context) {
  const left = node.data.left?.split('.').reduce((acc, k) => acc?.[k], context);
  const right = node.data.right;
  switch (node.data.operator) {
    case "==": return left == right;
    case "!=": return left != right;
    case ">":  return Number(left) > Number(right);
    case "<":  return Number(left) < Number(right);
    default: return false;
  }
}
