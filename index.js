import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
dotenv.config();

// Needed because __dirname doesn't exist in ES modules


// Proper ESM dirname handling
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("dirname =", __dirname);


const app = express();
app.use(cors());
app.use(bodyParser.json());

/* -------------------------
   Utility: Load Templates
-------------------------- */
function loadTemplates() {
  const filePath = path.join(__dirname,'templates.json');
  console.log(filePath)
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

/* -------------------------
   GET /templates
-------------------------- */
app.get('/templates', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  const all = loadTemplates();

  const filtered = q
    ? all.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          (t.description || '').toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q)
      )
    : all;

  res.json({ data: filtered });
});



/* -------------------------
   GET /templates/:name
-------------------------- */
app.get('/templates/:name', (req, res) => {
  const name = req.params.name;
  const all = loadTemplates();
  const t = all.find((x) => x.name === name);

  if (!t) return res.status(404).json({ error: 'Template not found' });

  res.json(t);
});

/* -------------------------
   POST /sync
   (Stub: In real world,
    this would call Meta API)
-------------------------- */
app.post('/sync', (req, res) => {
  const all = loadTemplates();
  res.json({ ok: true, count: all.length });
});

/* -------------------------
   POST /send-template
-------------------------- */
app.post('/send-template', async (req, res) => {
  try {
    const { templateName, to, components, language } = req.body;

    if (!templateName || !to)
      return res
        .status(400)
        .json({ error: 'templateName and to required' });

    // Build WhatsApp template payload
    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: language || 'en_US' },
        components: [
          {
            type: 'body',
            parameters: (components || []).map((c) => ({
              type: 'text',
              text: c,
            })),
          },
        ],
      },
    };

    const META_TOKEN = process.env.ACCESS_TOKEN;
    const PHONE_ID = process.env.PHONE_NUMBER_ID;

    if (META_TOKEN && PHONE_ID) {
      const url = `https://graph.facebook.com/v17.0/${PHONE_ID}/messages`;

      const resp = await axios.post(url, payload, {
        params: { access_token: META_TOKEN },
      });

      return res.json({ ok: true, meta: resp.data });
    } else {
      // Mock response (no Meta credentials)
      console.log('MOCK SEND:', payload);
      return res.json({ ok: true, mock: true, payload });
    }
  } catch (err) {
    console.error(err?.response?.data || err.message);
    res.status(500).json({
      error: 'send failed',
      detail: err?.response?.data || err.message,
    });
  }
});
const META_TOKEN = process.env.ACCESS_TOKEN;
    const PHONE_ID = process.env.PHONE_NUMBER_ID;
const res=axios.get(`https://graph.facebook.com/v17.0/${PHONE_ID}/message_templates?access_token=${META_TOKEN}`)
console.log(res.data)
/* -------------------------
   Start Server
-------------------------- */
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
