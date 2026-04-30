import express from 'express';
import { createServer as createViteServer } from 'vite';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchAirtableRecordById, fetchAirtableRecords, updateAirtableRecordStatus } from './services/airtable.ts';
import { getGoogleAuth, generateHallTicketPdf } from './services/google.ts';
import { sendEmail } from './services/email.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function createApp({ serveFrontend = true } = {}) {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // --- API Routes ---

  app.post('/api/airtable/tables', async (req, res) => {
    const { token, baseId } = req.body;
    if (!token || !baseId) {
      return res.status(400).json({ error: 'Airtable token and Base ID are required' });
    }
    
    try {
      // NOTE: Requires schema.bases:read scope on the PAT
      const fetchApi = (await import('node-fetch')).default || globalThis.fetch;
      const response = await fetchApi(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        let msg = `Error ${response.status}: ${response.statusText}`;
        try {
          const data = await response.json();
          if (data.error) {
            msg = data.error.message || data.error.type || JSON.stringify(data.error);
            if (response.status === 401 || response.status === 403) {
                msg += " (Ensure your Personal Access Token has 'schema.bases:read' scope)";
            }
          }
        } catch(e) {}
        throw new Error(msg);
      }
      
      const data = await response.json();
      res.json({ tables: data.tables });
    } catch (error: any) {
      console.error('Error fetching tables:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch tables' });
    }
  });

  app.post('/api/airtable/columns', async (req, res) => {
    const { config } = req.body;
    try {
      if (!config || !config.airtableToken || !config.airtableBaseId || !config.airtableTable) {
        return res.status(400).json({ error: 'Airtable configuration missing' });
      }
      
      const Airtable = (await import('airtable')).default;
      const base = new Airtable({ apiKey: config.airtableToken }).base(config.airtableBaseId);
      const records = await base(config.airtableTable).select({ maxRecords: 1 }).firstPage();
      
      if (records && records.length > 0) {
         const columns = new Set<string>();
         records.forEach((r: any) => Object.keys(r.fields).forEach(k => columns.add(k)));
         res.json({ columns: Array.from(columns) });
      } else {
        res.json({ columns: [] });
      }
    } catch (error: any) {
      console.error('Error fetching columns:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch columns' });
    }
  });

  app.post('/api/students', async (req, res) => {
    const { config } = req.body;
    try {
      if (!config || !config.airtableToken || !config.airtableBaseId || !config.airtableTable) {
        return res.status(400).json({ error: 'Airtable configuration missing' });
      }
      const records = await fetchAirtableRecords(config);
      res.json({ records });
    } catch (error: any) {
      console.error('Error fetching students:', error);
      let errorMessage = error.message;
      if (error.error === 'NOT_AUTHORIZED' || error.statusCode === 401) {
        errorMessage = 'Airtable: NOT_AUTHORIZED. Please verify your Personal Access Token and ensure it has "data.records:read" and "data.records:write" scopes for this base.';
      } else if (error.error === 'NOT_FOUND' || error.statusCode === 404) {
        errorMessage = 'Airtable: NOT_FOUND. Please double-check your Base ID and Table Name/ID. Ensure the token has access to this specific base.';
      }
      res.status(500).json({ error: errorMessage || error.error || 'Failed to fetch students from Airtable' });
    }
  });

  app.post('/api/process', async (req, res) => {
    let { student, config } = req.body;
    if (!config) {
      return res.status(400).json({ error: 'Configuration missing from request' });
    }
    
    try {
      if (!config.googleServiceAccount || !config.googleTemplateId) {
        throw new Error('Google configuration missing');
      }
      
      if (student?.id && config.airtableToken && config.airtableBaseId && config.airtableTable) {
        const latestStudent = await fetchAirtableRecordById(config, student.id);
        student = { ...student, ...latestStudent };
      }

      const requiredFields = ['hallTicketNo', 'studentName', 'father', 'mother'];
      if (config.optEmail !== false) {
        requiredFields.push('email');
      }
      const missingFields = requiredFields.filter(f => !student[f]);
      
      if (missingFields.length > 0) {
        throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
      }

      const optGenerate = config.optGenerate !== false;
      const optEmail = config.optEmail !== false;

      if (!optGenerate && !optEmail) {
        throw new Error('At least one of Generate or Email options must be selected');
      }

      console.log(`Processing hall ticket for ${student.studentName}... (Generate: ${optGenerate}, Email: ${optEmail})`);
      
      const auth = await getGoogleAuth(config.googleServiceAccount);
      // If we are NOT saving to drive, generateHallTicketPdf will return undefined for webViewLink
      const { buffer: pdfBuffer, webViewLink } = await generateHallTicketPdf(auth, config.googleTemplateId, student, optGenerate);
      console.log(`PDF generated for ${student.studentName}`);

      if (optEmail) {
        console.log(`Sending email to ${student.email}...`);
        await sendEmail(config, student.email, student, pdfBuffer);
        console.log(`Email sent to ${student.studentName}`);
      }

      console.log(`Updating Airtable status and hall ticket URL for ${student.studentName}...`);
      await updateAirtableRecordStatus(config, student.id, webViewLink);
      console.log(`Airtable updated for ${student.studentName}`);

      res.json({ success: true });
    } catch (error: any) {
      console.error(`Error processing student ${student?.studentName}:`, error);
      res.status(500).json({ error: error.message || 'Failed to process student' });
    }
  });

  if (!serveFrontend) {
    return app;
  }

  // Vite middleware
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : undefined,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return app;
}

async function startServer() {
  const app = await createApp();
  const PORT = Number(process.env.PORT) || 3000;

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

if (process.env.VERCEL !== '1') {
  startServer();
}
