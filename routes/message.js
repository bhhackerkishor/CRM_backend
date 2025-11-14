// src/routes/message.js
import express from "express";
import { getMessages, sendMessage } from "../controllers/messageController.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();
router.use(protect);

router.get("/", getMessages);
router.post("/send", sendMessage);

export default router;