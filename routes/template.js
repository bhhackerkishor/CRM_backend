// src/routes/template.js
import express from "express";
import {
  createTemplate,
  getTemplates,
  updateTemplate,
  deleteTemplate,
} from "../controllers/templateController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = express.Router();
router.use(protect);

router.post("/", authorize("admin", "manager"), createTemplate);
router.get("/", getTemplates);
router.patch("/:id", authorize("admin", "manager"), updateTemplate);
router.delete("/:id", authorize("admin", "manager"), deleteTemplate);

export default router;