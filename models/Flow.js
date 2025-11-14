import mongoose from "mongoose";

const flowSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true },
  name: { type: String, required: true },
  description: String,
  nodes: { type: Array, default: [] },
  edges: { type: Array, default: [] },

  // new trigger fields
  isActive: { type: Boolean, default: true },

  // keyword trigger (case-insensitive)
  triggers: {
    keywords: { type: [String], default: [] } // e.g. ["hi","start","catalog"]
  },

  // schedule config (null if not scheduled)
  schedule: {
    type: { type: String, enum: ["once","daily","weekly","cron","monthly"], default: null },
    time: String,        // "09:00" for daily / once usage (HH:mm)
    days: [String],      // ["mon","wed"] for weekly (optional)
    cron: String,        // full cron expression if type === "cron"
    timezone: String,    // e.g. "Asia/Kolkata"
    runOnContactsSegment: { type: String, default: null } // optional segment id
  },

  // allow flow to be default for the tenant (e.g. onboarding/default flow)
  isDefaultForTenant: { type: Boolean, default: false },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model("Flow", flowSchema);
