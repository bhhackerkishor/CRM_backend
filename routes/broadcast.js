// src/routes/broadcast.js
import express from "express";
import { createBroadcast, sendBroadcast, getBroadcasts } from "../controllers/broadcastController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = express.Router();
router.use(protect);

router.post("/", authorize("admin", "manager"), createBroadcast);
router.post("/:id/send", authorize("admin", "manager"), sendBroadcast);
router.get("/", getBroadcasts);

export default router;