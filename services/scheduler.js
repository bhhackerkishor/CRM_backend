import cron from "node-cron";
import Flow from "../models/Flow.js";
import FlowRun from "../models/FlowRun.js";
import Tenant from "../models/Tenant.js";
import { runFlowById } from "../utils/flowRunner.js";
import moment from "moment-timezone";

const runningJobs = new Map();

export function startScheduler() {
  // run every minute to check schedules (simpler)
  cron.schedule("* * * * *", async () => {
    try {
      const now = new Date();
      // find flows that are active and have schedule configured
      const flows = await Flow.find({ isActive: true, "schedule.type": { $exists: true, $ne: null } });
      for (const flow of flows) {
        const s = flow.schedule;
        if (!s) continue;

        // handle cron type
        if (s.type === "cron" && s.cron) {
          // We will schedule separately using node-cron if not already scheduled
          if (!runningJobs.has(flow._id.toString())) {
            // create job
            const job = cron.schedule(s.cron, async () => {
              // run for all contacts in the segment or for all contacts
              await triggerFlowForFlow(flow);
            }, { timezone: s.timezone || "UTC" });
            runningJobs.set(flow._id.toString(), job);
          }
          continue;
        }

        // handle once/daily/weekly simple checks using moment-timezone
        const tz = s.timezone || "UTC";
        const nowTz = moment().tz(tz);
        const scheduledTime = s.time || "00:00"; // "HH:mm"
        const [hh, mm] = scheduledTime.split(":").map(Number);

        // build moment for today at scheduled time
        const scheduledMoment = moment.tz({ year: nowTz.year(), month: nowTz.month(), day: nowTz.date(), hour: hh, minute: mm }, tz);

        // if within 0..59 seconds range to avoid duplicate runs in minute window
        const diffSeconds = Math.abs(nowTz.diff(scheduledMoment, "seconds"));
        if (diffSeconds <= 30) {
          // For weekly: check day name
          if (s.type === "daily" || (s.type === "weekly" && s.days?.includes(nowTz.format("ddd").toLowerCase()))) {
            // Avoid running multiple times per day — store lastRun timestamp somewhere (FlowRun or flow.lastScheduledAt)
            const lastRun = flow._lastScheduledAt || 0;
            if (!flow._lastScheduledAt || (Date.now() - flow._lastScheduledAt) > 1000 * 60 * 60) {
              // run it
              await triggerFlowForFlow(flow);
              // mark last run
              flow._lastScheduledAt = Date.now();
              await flow.save();
            }
          }
        }
      }
    } catch (err) {
      console.error("Scheduler error:", err);
    }
  });
}

async function triggerFlowForFlow(flow) {
  // decide recipients — default: run for all contacts of that tenant or a segment
  const tenantId = flow.tenantId;
  // TODO: support segments. For now: all contacts
  const contacts = await require("../models/Contact").default.find({ tenantId }).limit(200); // limit to avoid floods
  for (const c of contacts) {
    try {
      await runFlowById(flow._id, c.phone);
    } catch (err) {
      console.error("Failed runFlowById for scheduled flow:", err.message);
    }
  }
}
