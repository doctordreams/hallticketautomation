import { google } from 'googleapis';
import { Readable } from 'stream';

export async function getGoogleAuth(serviceAccountJson: string) {
  let credentials: any;
  try {
    credentials = JSON.parse(serviceAccountJson);
  } catch {
    throw new Error('Google credential JSON is invalid. Paste the full Service Account JSON file contents.');
  }

  if (!credentials.client_email || !credentials.private_key) {
    throw new Error(
      'Google Service Account JSON must include client_email and private_key so the app can access your Google Slides template. These fields are only used for Google authentication and are not added to the hall ticket.'
    );
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/presentations',
      'https://www.googleapis.com/auth/drive',
    ],
  });
  return auth;
}

export async function generateHallTicketPdf(auth: any, templateId: string, data: any, saveToDrive: boolean = true): Promise<{buffer: Buffer, webViewLink?: string}> {
  const drive = google.drive({ version: 'v3', auth });
  const slides = google.slides({ version: 'v1', auth });

  // 1. Copy the template
  const copyResponse = await drive.files.copy({
    fileId: templateId,
    requestBody: {
      name: `Hall_Ticket_${data.hallTicketNo}_${data.studentName}`,
    },
  });
  const newPresentationId = copyResponse.data.id!;

  // 2. Replace placeholders in the new presentation
  const replacements = {
    '{{Hall_TicketNo}}': data.hallTicketNo,
    '{{DISTRICT}}': data.district,
    '{{STUDENT_NAME}}': data.studentName,
    '{{FATHER_NAME}}': data.father,
    '{{MOTHER_NAME}}': data.mother,
    '{{TEST_CENTRE_NAME}}': data.testCentreName,
  };

  const requests = Object.entries(replacements).map(([text, value]) => ({
    replaceAllText: {
      containsText: { text, matchCase: true },
      replaceText: String(value || ''),
    },
  }));

  await slides.presentations.batchUpdate({
    presentationId: newPresentationId,
    requestBody: {
      requests,
    },
  });

  // 3. Export as PDF to buffer
  const exportResponse = await drive.files.export({
    fileId: newPresentationId,
    mimeType: 'application/pdf',
  }, { responseType: 'arraybuffer' });
  const buffer = Buffer.from(exportResponse.data as ArrayBuffer);

  let webViewLink = undefined;

  if (saveToDrive) {
    // 4. Create a permanent PDF file in Drive to get a shareable link
    const media = {
      mimeType: 'application/pdf',
      body: Readable.from(buffer),
    };
    const createPdfResponse = await drive.files.create({
      requestBody: {
        name: `Hall_Ticket_${data.hallTicketNo}_${data.studentName}.pdf`,
        mimeType: 'application/pdf',
      },
      media: media,
      fields: 'id, webViewLink'
    });
    const pdfFileId = createPdfResponse.data.id!;
    webViewLink = createPdfResponse.data.webViewLink!;

    // 5. Make the new PDF publicly viewable
    await drive.permissions.create({
      fileId: pdfFileId,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    });
  }

  // 6. Delete the temporary slide presentation
  await drive.files.delete({
    fileId: newPresentationId,
  });

  return { buffer, webViewLink };
}
