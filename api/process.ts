import { fetchAirtableRecordById, updateAirtableRecordStatus } from '../services/airtable.ts';
import { sendEmail } from '../services/email.ts';
import { generateHallTicketPdf, getGoogleAuth } from '../services/google.ts';
import { getBody, sendError } from './_utils.ts';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let { student, config } = getBody(req);
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
    const missingFields = requiredFields.filter(field => !student[field]);
    if (missingFields.length > 0) {
      throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
    }

    const optGenerate = config.optGenerate !== false;
    const optEmail = config.optEmail !== false;
    if (!optGenerate && !optEmail) {
      throw new Error('At least one of Generate or Email options must be selected');
    }

    const auth = await getGoogleAuth(config.googleServiceAccount);
    const { buffer: pdfBuffer, webViewLink } = await generateHallTicketPdf(auth, config.googleTemplateId, student, optGenerate);

    if (optEmail) {
      await sendEmail(config, student.email, student, pdfBuffer);
    }

    await updateAirtableRecordStatus(config, student.id, webViewLink);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error(`Error processing student ${student?.studentName}:`, error);
    return sendError(res, 500, error, 'Failed to process student');
  }
}
