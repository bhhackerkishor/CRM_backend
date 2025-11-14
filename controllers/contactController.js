// src/controllers/contactController.js
import Contact from "../models/Contact.js";

// GET /api/v1/contacts
export const getContacts = async (req, res) => {
  const contacts = await Contact.find({ tenantId: req.user.tenantId }).sort({ createdAt: -1 });
  console.log(req.user.tenantId,"contact")
  res.json(contacts);
  //console.log(req.tenantId)
};

// GET /api/v1/contacts/:id
export const getContact = async (req, res) => {
  const contact = await Contact.findOne({ _id: req.params.id, tenantId: req.user.tenantId });
  if (!contact) return res.status(404).json({ message: "Contact not found" });
  res.json(contact);
};

// POST /api/v1/contacts
export const createContact = async (req, res) => {
  const contact = await Contact.create({ ...req.body, tenantId: req.user.tenantId });
  res.status(201).json(contact);
};

// PATCH /api/v1/contacts/:id
export const updateContact = async (req, res) => {
  const contact = await Contact.findOneAndUpdate(
    { _id: req.params.id, tenantId: req.user.tenantId },
    { ...req.body, updatedAt: new Date() },
    { new: true, runValidators: true }
  );
  if (!contact) return res.status(404).json({ message: "Contact not found" });
  res.json(contact);
};

// DELETE /api/v1/contacts/:id
export const deleteContact = async (req, res) => {
  const contact = await Contact.findOneAndDelete({ _id: req.params.id, tenantId: req.user.tenantId });
  if (!contact) return res.status(404).json({ message: "Contact not found" });
  res.json({ message: "Contact deleted" });
};