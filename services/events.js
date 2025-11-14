import Cart from "../models/Cart.js";
import Flow from "../models/Flow.js";
import { runFlowById } from "../utils/flowRunner.js";

export async function handleCartUpdated(cart) {
  // if cart not checked out, schedule an abandoned-cart flow after X minutes
  // Example simplistic: when cart changes, schedule a timer (setTimeout) — for production use a job queue.
  setTimeout(async () => {
    // check if cart still exists and not converted to order
    const fresh = await Cart.findById(cart._id);
    if (!fresh) return;
    if (fresh.total > 0) {
      // find tenant's abandoned cart flow
      const flow = await Flow.findOne({ tenantId: cart.tenantId, "triggers.keywords": { $exists: true }, isActive: true, name: /abandon/i });
      // or have dedicated field flow.triggers.event === 'cart_abandoned'
      const flow2 = await Flow.findOne({ tenantId: cart.tenantId, "triggers.event": "cart_abandoned", isActive: true });
      const selected = flow2 || flow;
      if (selected) {
        await runFlowById(selected._id, cart.userPhone);
      }
    }
  }, 1000 * 60 * 20); // 20 minutes
}
