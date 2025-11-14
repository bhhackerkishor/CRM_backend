// src/controllers/templateController.js
import Template from "../models/Template.js";

export const createTemplate = async (req, res) => {
  const { name, templateId, language, body } = req.body;
  const variables = extractVariables(body); // e.g., {{1}}, {{name}}

  const template = await Template.create({
    tenant: req.tenantId,
    name,
    templateId,
    language,
    body,
    variables,
  });

  res.status(201).json(template);
};

export const getTemplates = async (req, res) => {
  const templates = await Template.find({ tenant: req.tenantId }).sort({ createdAt: -1 });
  res.json(templates);
};

export const updateTemplate = async (req, res) => {
  const { body } = req.body;
  const variables = body ? extractVariables(body) : undefined;

  const template = await Template.findOneAndUpdate(
    { _id: req.params.id, tenant: req.tenantId },
    { ...req.body, variables },
    { new: true, runValidators: true }
  );

  if (!template) return res.status(404).json({ message: "Template not found" });
  res.json(template);
};

export const deleteTemplate = async (req, res) => {
  const template = await Template.findOneAndDelete({ _id: req.params.id, tenant: req.tenantId });
  if (!template) return res.status(404).json({ message: "Template not found" });
  res.json({ message: "Template deleted" });
};

// Extract {{name}}, {{1}} from body
function extractVariables(body) {
  const matches = body.match(/\{\{[^}]+\}\}/g) || [];
  return matches.map((m) => m.slice(2, -2).trim());
}