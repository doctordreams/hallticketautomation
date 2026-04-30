import nodemailer from 'nodemailer';

export async function sendEmail(config: any, to: string, student: any, pdfBuffer: Buffer) {
  const transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: parseInt(config.smtpPort, 10),
    secure: parseInt(config.smtpPort, 10) === 465, // true for 465, false for other ports
    auth: {
      user: config.smtpUser,
      pass: config.smtpPass,
    },
  });

  const placeholders = [
    { key: '{{studentName}}', value: student.studentName },
    { key: '{{STUDENT_NAME}}', value: student.studentName },
    { key: '{{hallTicketNo}}', value: student.hallTicketNo },
    { key: '{{Hall_TicketNo}}', value: student.hallTicketNo },
    { key: '{{father}}', value: student.father },
    { key: '{{FATHER_NAME}}', value: student.father },
    { key: '{{mother}}', value: student.mother },
    { key: '{{MOTHER_NAME}}', value: student.mother },
    { key: '{{district}}', value: student.district },
    { key: '{{DISTRICT}}', value: student.district },
    { key: '{{TEST_CENTRE_NAME}}', value: student.testCentreName },
    { key: '{{testtime}}', value: student.testTime },
  ];

  let subject = config.emailSubject || '';
  let text = config.emailBody || '';

  placeholders.forEach(p => {
    // Escape string for regex or simply use string replace with global replacement pattern
    const regex = new RegExp(p.key.replace(/\{/g, '\\{').replace(/\}/g, '\\}'), 'gi');
    subject = subject.replace(regex, p.value || '');
    text = text.replace(regex, p.value || '');
  });

  const safeStudentName = (student.studentName || 'UNKNOWN').replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeHallTicketNo = (student.hallTicketNo || 'UNKNOWN').replace(/[^a-zA-Z0-9_-]/g, '_');

  await transporter.sendMail({
    from: `"${config.smtpUser}" <${config.smtpUser}>`, // sender address
    to: to,
    subject: subject,
    text: text,
    attachments: [
      {
        filename: `Hall_Ticket_${safeHallTicketNo}_${safeStudentName}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf'
      }
    ]
  });
}
