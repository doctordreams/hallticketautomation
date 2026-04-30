import Airtable from 'airtable';
import { getBody, sendError } from '../_utils.ts';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { config } = getBody(req);
  if (!config || !config.airtableToken || !config.airtableBaseId || !config.airtableTable) {
    return res.status(400).json({ error: 'Airtable configuration missing' });
  }

  try {
    const base = new Airtable({ apiKey: config.airtableToken }).base(config.airtableBaseId);
    const records = await base(config.airtableTable).select({ maxRecords: 1 }).firstPage();

    if (records && records.length > 0) {
      const columns = new Set<string>();
      records.forEach((record: any) => Object.keys(record.fields).forEach(key => columns.add(key)));
      return res.status(200).json({ columns: Array.from(columns) });
    }

    return res.status(200).json({ columns: [] });
  } catch (error) {
    console.error('Error fetching columns:', error);
    return sendError(res, 500, error, 'Failed to fetch columns');
  }
}
