import { fetchAirtableRecords } from '../services/airtable.ts';
import { getBody } from './_utils.ts';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { config } = getBody(req);
  if (!config || !config.airtableToken || !config.airtableBaseId || !config.airtableTable) {
    return res.status(400).json({ error: 'Airtable configuration missing' });
  }

  try {
    const records = await fetchAirtableRecords(config);
    return res.status(200).json({ records });
  } catch (error: any) {
    console.error('Error fetching students:', error);
    let errorMessage = error.message;
    if (error.error === 'NOT_AUTHORIZED' || error.statusCode === 401) {
      errorMessage = 'Airtable: NOT_AUTHORIZED. Please verify your Personal Access Token and ensure it has "data.records:read" and "data.records:write" scopes for this base.';
    } else if (error.error === 'NOT_FOUND' || error.statusCode === 404) {
      errorMessage = 'Airtable: NOT_FOUND. Please double-check your Base ID and Table Name/ID. Ensure the token has access to this specific base.';
    }
    return res.status(500).json({ error: errorMessage || error.error || 'Failed to fetch students from Airtable' });
  }
}
