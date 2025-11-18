// src/controllers/templateController.js
import Template from "../models/Template.js";
import fs from "fs";
import path from "path";
import axios from "axios";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";

// -------------------- LOWDB SETUP -----------------------
const DB_FILE = path.join(process.cwd(), "templates.json");

const adapter = new JSONFile(DB_FILE);
const db = new Low(adapter, { templates: [], sampleTemplates: [] });

await db.read();
db.data ||= { templates: [], sampleTemplates: [] };
await db.write();

// --------------------------------------------------------

/**
 * Extract {{variables}} from message body
 */
function extractVariables(body) {
  const matches = body.match(/\{\{[^}]+\}\}/g) || [];
  return matches.map(m => m.slice(2, -2).trim());
}



/**
 * 🎯 CREATE CUSTOM TEMPLATE (stored in MongoDB)
 */
export const createTemplate = async (req, res) => {
  const { name, templateId, language, body } = req.body;
  console.log(req.body,"create")

  const variables = extractVariables(body);

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



/**
 * 🎯 GET ALL TEMPLATES (Mongo + synced + sample templates)
 */
export const getTemplates = async (req, res) => {
  await db.read();
  
  const mongoTemplates = await Template.find({ tenant: req.tenantId }).sort({
    createdAt: -1,
  });

  res.json({
    custom: mongoTemplates,
    synced: db.data,
    samples: db.data.sampleTemplates,
  });
};



/**
 * 🎯 UPDATE CUSTOM TEMPLATE
 */
export const updateTemplate = async (req, res) => {
  const { body } = req.body;
  console.log(body)
  const variables = body ? extractVariables(body) : undefined;

  const template = await Template.findOneAndUpdate(
    { _id: req.params.id, tenant: req.tenantId },
    { ...req.body, variables },
    { new: true }
  );

  if (!template)
    return res.status(404).json({ message: "Template not found" });

  res.json(template);
};



/**
 * 🎯 DELETE CUSTOM TEMPLATE
 */
export const deleteTemplate = async (req, res) => {
  const template = await Template.findOneAndDelete({
    _id: req.params.id,
    tenant: req.tenantId,
  });

  if (!template)
    return res.status(404).json({ message: "Template not found" });

  res.json({ message: "Template deleted" });
};



/**
 * 🎯 SYNC WHATSAPP APPROVED TEMPLATES + store in LOWDB
 */
export const syncTemplates = async (req, res) => {
  try {
    const WABA_ID = process.env.PHONE_NUMBER_ID;
    const ACCESS_TOKEN = process.env.ACCESS_TOKEN;

    if (!WABA_ID || !ACCESS_TOKEN) {
      return res.status(400).json({
        error: "Missing PHONE_NUMBER_ID or ACCESS_TOKEN",
      });
    }

    const url = `https://graph.facebook.com/v17.0/${WABA_ID}/message_templates`;

    const { data } = await axios.get(url, {
      params: { access_token: ACCESS_TOKEN },
    });

    const templates = data.data || [];

    // Save to LowDB
    await db.read();
    db.data.templates = templates;
    await db.write();

    res.json({ ok: true, count: templates.length });
  } catch (err) {
    res.status(500).json({ error: err?.response?.data || err.message });
  }
};
// controllers/templateController.js → Add this function
export const submitTemplateForApproval = async (req, res) => {
  try {
    const { name, language, category, body, variables } = req.body;
    const WABA_ID = process.env.PHONE_NUMBER_ID;
    const TOKEN = process.env.ACCESS_TOKEN;

    const components = [
      {
        type: "BODY",
        text: body,
      },
    ];

    // Add buttons if exist
    if (req.body.buttons) {
      components.push({
        type: "BUTTONS",
        buttons: req.body.buttons.map((b, i) => ({
          type: "QUICK_REPLY",
          text: b,
        })),
      });
    }

    const payload = {
      name,
      language,
      category: category || "MARKETING",
      components,
    };

    const response = await axios.post(
      `https://graph.facebook.com/v20.0/${WABA_ID}/message_templates`,
      payload,
      { headers: { Authorization: `Bearer ${TOKEN}` } }
    );

    // Save as custom + pending
    const template = await Template.create({
      tenant: req.tenantId,
      name,
      language,
      body,
      variables: variables || extractVariables(body),
      category: category || "MARKETING",
      status: "PENDING",
      metaTemplateId: response.data.id,
      submittedAt: new Date(),
    });

    res.json(template);
  } catch (err) {
    console.log(err.response?.data);
    res.status(500).json({
      error: err.response?.data?.error || "Failed to submit template",
    });
  }
};

// controllers/templateController.js → Add this
export const cloneApprovedTemplate = async (req, res) => {
  try {
    const { name } = req.params; // original approved template name
    const { newName } = req.body; // user chooses new name

    await db.read();
    const approvedTemplate = db.data.templates.find(t => t.name === name);

    if (!approvedTemplate) {
      return res.status(404).json({ error: "Approved template not found" });
    }

    // Create a fresh copy in MongoDB (as custom draft)
    const cloned = await Template.create({
      tenant: req.tenantId,
      name: newName || `${name}_v2`,
      language: approvedTemplate.language,
      body: approvedTemplate.components.find(c => c.type === "BODY")?.text || "",
      category: approvedTemplate.category,
      variables: extractVariables(approvedTemplate.components.find(c => c.type === "BODY")?.text || ""),
      buttons: approvedTemplate.components
        .find(c => c.type === "BUTTONS")
        ?.buttons?.map(b => b.text) || [],
      source: "cloned_from_approved",
      originalName: name,
    });

    res.json(cloned);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};