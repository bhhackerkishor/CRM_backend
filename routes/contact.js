// src/routes/contact.js
import express from "express";
import {
  getContacts,
  getContact,
  createContact,
  updateContact,
  deleteContact,
} from "../controllers/contactController.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();

router.use(protect); // All require auth

router.get("/", getContacts);
router.get("/:id", getContact);
router.post("/", createContact);
router.patch("/:id", updateContact);
router.delete("/:id", deleteContact);

export default router;