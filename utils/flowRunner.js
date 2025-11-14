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
  //console.log(tenant, to, text)
  const res =await axios.post(`https://graph.facebook.com/v20.0/${tenant.phoneNumberId}/messages`, {
    messaging_product: "whatsapp", to, type: "text", text: { body: text }
  }, { headers: { Authorization:`Bearer ${tenant.accessToken}` } });

  console.log(res.data)

  await Message.create({ tenantId: tenant._id, from: tenant.phoneNumberId, to, message: text, direction: "outbound", status: "sent" });
}

async function sendInteractive(tenant, to, data) {
  console.log("sendInteractive")
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
  const response= await axios.post(`https://graph.facebook.com/v20.0/${tenant.phoneNumberId}/messages`, payload, { headers:{ Authorization:`Bearer ${tenant.accessToken}` }});
  console.log(response)
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
export async function continueFlowFromButton(userPhone, replyId) {
  console.log("➡️ Continue flow for user:", userPhone, "replyId:", replyId);

  // 1. Find waiting run
  const run = await FlowRun.findOne({ userPhone, status: "waiting" })
    .sort({ updatedAt: -1 });

  if (!run) {
    console.log("❌ No waiting flow run for this user");
    return;
  }

  const flow = await Flow.findById(run.flowId);
  const tenant = await Tenant.findById(run.tenantId);

  if (!flow || !tenant) {
    console.log("❌ Flow or tenant missing");
    return;
  }

  console.log("🟡 Waiting at node:", run.context.waitingNodeId);

  // 2. Find button → nextNode mapping
  const match = flow.edges.find(
    e =>
      e.source === run.context.waitingNodeId &&
      e.sourceHandle === replyId
  );

  if (!match) {
    console.log("⚠️ No edge found for:", replyId);
    return;
  }

  // 3. Load next node
  let current = flow.nodes.find(n => n.id === match.target);
  if (!current) {
    console.log("❌ next node missing");
    return;
  }

  // 4. Set running mode
  run.status = "running";
  run.currentNodeId = current.id;
  run.context.waitingFor = null;
  run.context.waitingNodeId = null;
  run.markModified("context");
  await run.save();

  console.log("▶️ Continuing with node:", current.type);

  // 5. LOOP just like runFlowById()
  while (current) {
    const result = await executeNode(flow, run, tenant, userPhone, current);

    // stop flow if node waits (mediaButtons)
    if (result?.stop) {
      console.log("⏸️ Node entered waiting mode:", current.type);
      return;
    }

    // find next sequential edge (only edges without sourceHandle)
    const nextEdge = flow.edges.find(
      e => e.source === current.id && !e.sourceHandle
    );

    current = nextEdge
      ? flow.nodes.find(n => n.id === nextEdge.target)
      : null;

    if (current) {
      run.currentNodeId = current.id;
      run.updatedAt = Date.now();
      await run.save();
    }
  }

  // end of flow
  run.status = "finished";
  await run.save();
  console.log("✅ Flow finished for", userPhone);
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
      console.log("workingsendInteractive")
      const newData = {
        ...node.data,
        title: resolveVariables(node.data.title, run.context),
      };
      console.log("workingsendInteractivemid")
      await sendInteractive(tenant, to, newData);

      run.status = "waiting";
      run.context.waitingNodeId = node.id;
      run.context.waitingFor = "button_reply";
      run.markModified('context'); //to change the context in a indirect
      console.log("workingsendInteractiveend")
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
