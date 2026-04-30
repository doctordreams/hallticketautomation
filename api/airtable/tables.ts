import { getBody, sendError } from '../_utils.ts';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token, baseId } = getBody(req);
  if (!token || !baseId) {
    return res.status(400).json({ error: 'Airtable token and Base ID are required' });
  }

  try {
    const response = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
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
      } catch {}
      throw new Error(msg);
    }

    const data = await response.json();
    return res.status(200).json({ tables: data.tables });
  } catch (error) {
    console.error('Error fetching tables:', error);
    return sendError(res, 500, error, 'Failed to fetch tables');
  }
}
