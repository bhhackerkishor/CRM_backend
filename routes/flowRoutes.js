import express from "express";
import Flow from "../models/Flow.js";
import { startFlow } from "../utils/flowRunner.js";

const router = express.Router();


// ✅ Get all flows for a tenant
router.get("/", async (req, res) => {
  try {
    const { tenantId } = req.query;
    console.log(req.query)

    if (!tenantId) return res.status(400).json({ error: "tenantId required" });

    const docs = await Flow.find({ tenantId }).sort({ createdAt: -1 });
    console.log(docs)
    res.json({ success: true, data: docs });
  } catch (err) {
    console.log(err)
    res.status(500).json({ error: err.message });
  }
});


// ✅ create
router.post("/", async (req, res) => {
  try {
    const { tenantId, name, nodes, edges } = req.body;
    if (!tenantId) return res.status(400).json({ error: "tenantId required" });

    const doc = await Flow.create({ tenantId, name, nodes, edges });
    res.json({ success: true, data: doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ get (by id, tenant scoped)
router.get("/:id", async (req, res) => {
  try {
    const { tenantId } = req.query; // from frontend session
    const doc = await Flow.findOne({ _id: req.params.id, tenantId });
    if (!doc) return res.status(404).json({ error: "Flow not found" });
    res.json({ success: true, data: doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ update
router.put("/:id", async (req, res) => {
  try {
    const { tenantId, ...update } = req.body;
    const doc = await Flow.findOneAndUpdate(
      { _id: req.params.id, tenantId },
      update,
      { new: true }
    );
    if (!doc) return res.status(404).json({ error: "Flow not found or unauthorized" });
    res.json({ success: true, data: doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ run a flow manually
router.post("/:id/run", async (req, res) => {
  try {
    const { phone, tenantId } = req.body;
    //console.log(req.body)
    if (!phone) return res.status(400).json({ error: "Missing phone number" });

    const flow = await Flow.findOne({ _id: req.params.id, tenantId });
    console.log(Flow)
    if (!flow) return res.status(404).json({ error: "Flow not found or unauthorized" });
    let to=phone;
    await startFlow(flow._id, to);
    res.json({ success: true, message: "Flow triggered successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});




export default router;
