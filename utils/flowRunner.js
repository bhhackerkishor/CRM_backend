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

  console.log(res)

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
  //console.log(tenant, to, data)
  const response= await axios.post(`https://graph.facebook.com/v20.0/${tenant.phoneNumberId}/messages`, payload, { headers:{ Authorization:`Bearer ${tenant.accessToken}` }});
  console.log(response.data)
  await Message.create({ tenantId: tenant._id, from: tenant.phoneNumberId, to, message: data.title, direction: "outbound", status: "sent", media: data.image || null });
}

export async function startFlow(flowId, userPhone) {
  console.log(flowId, userPhone)
  const flow = await Flow.findById(flowId);
  if (!flow) throw new Error("Flow not found");

  const tenant = await Tenant.findById(flow.tenantId);
  if (!tenant) throw new Error("Tenant not found");

  const run = await FlowRun.create({
    flowId,
    tenantId: tenant._id,
    userPhone,
    status: "running",
    context: {}
  });

  const startNode =
    flow.nodes.find(n => n.type === "input") ||
    flow.nodes.find(n => !flow.edges.some(e => e.target === n.id));

  return runFlowStep(flow, run, tenant, userPhone, startNode);
}


// Run a flow by id
async function runFlowStep(flow, run, tenant, userPhone, startNode) {
  let current = startNode;
  
  while (current) {
    console.log(current.type)
    run.currentNodeId = current.id;
    run.updatedAt = Date.now();
    await run.save();

    const type = current.type;
    const data = current.data || {};

    // ---------------- NODE EXECUTION ----------------
    switch (type) {
      
      // 1️⃣ Send plain text
      case "message":
        console.log(type)
        await sendText(tenant, userPhone, resolveVariables(data.label, run.context));
        break;

      // 2️⃣ Media + Buttons → WAIT mode
      case "mediaButtons": {
        console.log(type)
        const finalData = {
          ...data,
          title: resolveVariables(data.title, run.context)
        };

        await sendInteractive(tenant, userPhone, finalData);

        run.status = "waiting";
        run.context.waitingNodeId = current.id;
        run.context.waitingFor = "button_reply";
        run.markModified("context");
        await run.save();

        return; // pause flow
      }

      // 3️⃣ Condition
      case "condition": {
        const result = evaluateCondition(current, run.context);
        const handle = result ? "true" : "false";

        const nextEdge = flow.edges.find(
          e => e.source === current.id && e.sourceHandle === handle
        );

        current = nextEdge
          ? flow.nodes.find(n => n.id === nextEdge.target)
          : null;

        continue;
      }

      // 4️⃣ Wait
      case "wait":
        await new Promise(res => setTimeout(res, data.ms || 2000));
        break;

      // 5️⃣ API call
      case "call_api":
        try {
          await axios.post(data.url, { user: userPhone, ctx: run.context });
        } catch (err) {
          console.log("API failed:", err.message);
        }
        break;

      // 6️⃣ Set variable
      case "set_variable":
        run.context[data.key] = data.value;
        run.markModified("context");
        await run.save();
        break;

      // 7️⃣ Input node (expect user text)
      case "capture":
        run.status = "waiting";
        run.context.waitingNodeId = current.id;
        run.context.waitingFor = "text_reply";
        run.markModified("context");
        await run.save();
        return;

      // 8️⃣ Add to cart
      case "add_to_cart":
        await addToCart(tenant._id, userPhone, data.productId, data.qty || 1);
        break;

      // 9️⃣ Create order + payment link
      case "create_order":
        await createOrderAndSendPaymentLink(tenant, userPhone, data);
        return; // stop flow
    }

    // ---------------- MOVE TO NEXT NODE ----------------
    const nextEdge = flow.edges.find(
      e => e.source === current.id && !e.sourceHandle
    );

    current = nextEdge
      ? flow.nodes.find(n => n.id === nextEdge.target)
      : null;
  }

  run.status = "finished";
  await run.save();
}
export async function continueFlowByUserReply(userPhone, replyIdOrText) {
  const run = await FlowRun.findOne({ userPhone, status: "waiting" })
    .sort({ updatedAt: -1 });

  if (!run) return;

  const flow = await Flow.findById(run.flowId);
  const tenant = await Tenant.findById(run.tenantId);

  let nextNode = null;

  // 1️⃣ BUTTON REPLY
  if (run.context.waitingFor === "button_reply") {
    nextNode = findButtonNextNode(flow, run, replyIdOrText);
  }

  // 2️⃣ TEXT REPLY
  else if (run.context.waitingFor === "text_reply") {
    nextNode = findInputNextNode(flow, run, replyIdOrText);

    // save text to context
    run.context.lastUserMessage = replyIdOrText;
    run.markModified("context");
    await run.save();
  }

  if (!nextNode) {
    console.log("No next node matched for response");
    return;
  }

  // Reset waiting
  run.status = "running";
  run.context.waitingFor = null;
  run.context.waitingNodeId = null;
  run.markModified("context");
  await run.save();

  return runFlowStep(flow, run, tenant, userPhone, nextNode);
}
function findButtonNextNode(flow, run, replyId) {
  const edge = flow.edges.find(
    e =>
      e.source === run.context.waitingNodeId &&
      e.sourceHandle === replyId
  );

  return edge ? flow.nodes.find(n => n.id === edge.target) : null;
}

function findInputNextNode(flow, run, text) {
  const edge = flow.edges.find(
    e =>
      e.source === run.context.waitingNodeId &&
      e.sourceHandle === "onInput"
  );

  return edge ? flow.nodes.find(n => n.id === edge.target) : null;
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

      case "capture"

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
