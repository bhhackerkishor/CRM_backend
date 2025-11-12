import Flow from "../models/Flow.js";
import { runFlow } from "../flowRunner.js";
import Tenant from "../models/Tenant.js";

export const webhookReceiver = async (req, res) => {
  try {
    const data = req.body;
    // log raw
    console.log("Webhook:", JSON.stringify(data));

    const change = data.entry?.[0]?.changes?.[0];
    if (!change) return res.sendStatus(200);

    const phoneNumberId = change.value?.metadata?.phone_number_id;
    // map phoneNumberId -> tenant
    const tenant = await Tenant.findOne({ phoneNumberId });
    if (!tenant) return res.sendStatus(200);

    // extract message
    const messageInfo = change.value.messages?.[0];
    if (messageInfo) {
      const from = messageInfo.from;
      const text = messageInfo.text?.body || "";
      // create contact if not exists
      let contact = await Contact.findOne({ phone: from, tenantId: tenant._id });
      if (!contact) contact = await Contact.create({ phone: from, tenantId: tenant._id });

      // store message
      await Message.create({
        tenantId: tenant._id,
        contactId: contact._id,
        from,
        to: tenant.phoneNumberId,
        message: text,
        direction: "inbound",
      });

      // find flows with trigger matching this event (e.g., trigger.keyword === 'hi' or on_message)
      const flows = await Flow.find({ tenantId: tenant._id, active: true });
      // naive: run all flows that have a trigger node (improve by indexing)
      for (const flow of flows) {
        // prepare context
        const ctx = { tenantId: tenant._id.toString(), contact: contact.toObject(), payload: { text } };
        // Optionally filter flows: only those with trigger matching ('on_message' or keyword)
        // Simple run
        runFlow(flow, ctx).catch(err => console.error("Flow run error:", err));
      }
    }
    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
};
