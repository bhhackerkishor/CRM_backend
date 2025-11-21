import express from "express";
import { getAllTenants, updateTenant ,TenantOnboarding,verifyCredentials} from "../controllers/tenantController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = express.Router();

router.use(protect);

router.get("/", authorize("admin"), getAllTenants);
router.patch("/:id", authorize("admin"), updateTenant);
router.post("/complete", TenantOnboarding);
router.post("/verify-credentials",verifyCredentials );
export default router;