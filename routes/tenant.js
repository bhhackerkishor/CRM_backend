import express from "express";
import { getAllTenants, updateTenant } from "../controllers/tenantController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = express.Router();

router.use(protect);

router.get("/", authorize("admin"), getAllTenants);
router.patch("/:id", authorize("admin"), updateTenant);

export default router;