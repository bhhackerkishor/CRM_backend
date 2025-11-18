// src/routes/template.js
import express from "express";
import {
  createTemplate,
  getTemplates,
  updateTemplate,
  deleteTemplate,
  syncTemplates,
  submitTemplateForApproval,
  cloneApprovedTemplate,
} from "../controllers/templateController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = express.Router();

router.use(protect);

// Custom CRUD (MongoDB)
router.post("/", authorize("admin", "manager"), createTemplate);
router.get("/", getTemplates);
// routes/template.js → Add route
router.post("/submit", authorize("admin", "manager"), submitTemplateForApproval);
router.patch("/:id", authorize("admin", "manager"), updateTemplate);
router.delete("/:id", authorize("admin", "manager"), deleteTemplate);
// routes/template.js → Add this route
router.post("/clone/:name", authorize("admin", "manager"), cloneApprovedTemplate);
// Sync from WhatsApp API
router.get("/sync", syncTemplates);

export default router;
