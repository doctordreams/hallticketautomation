import Airtable from 'airtable';

function formatDateTime(val: any) {
  if (!val) return '';
  if (typeof val === 'string' && val.includes('T') && val.endsWith('Z')) {
    try {
      const d = new Date(val);
      if (!isNaN(d.getTime())) {
        return d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      }
    } catch (e) {}
  }
  return String(val);
}

function normalizeFieldName(value: string) {
  return value.replace(/[{}]/g, '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function getRecordValue(record: any, configuredField: string | undefined, aliases: string[]) {
  const fieldNames = [configuredField, ...aliases].filter(Boolean) as string[];

  for (const fieldName of fieldNames) {
    const value = record.get(fieldName);
    if (value !== undefined && value !== null && value !== '') return value;
  }

  const fields = record.fields || {};
  const normalizedFields = new Map(
    Object.entries(fields).map(([key, value]) => [normalizeFieldName(key), value])
  );

  for (const fieldName of fieldNames) {
    const value = normalizedFields.get(normalizeFieldName(fieldName));
    if (value !== undefined && value !== null && value !== '') return value;
  }

  return '';
}

export async function fetchAirtableRecords(config: any) {
  const base = new Airtable({ apiKey: config.airtableToken }).base(config.airtableBaseId);
  const records = await base(config.airtableTable).select({
    filterByFormula: `IF({STATUS} = '${config.statusFetch}', TRUE(), FALSE())`
  }).all();

  return records.map(record => mapAirtableRecord(record, config));
}

export async function fetchAirtableRecordById(config: any, recordId: string) {
  const base = new Airtable({ apiKey: config.airtableToken }).base(config.airtableBaseId);
  const record = await base(config.airtableTable).find(recordId);
  return mapAirtableRecord(record, config);
}

function mapAirtableRecord(record: any, config: any) {
  return {
    id: record.id,
    hallTicketNo: getRecordValue(record, config.colHallTicketNo, ['Hall_TicketNo', 'Hall Ticket No', 'Hall TicketNo', 'ROLL NO', 'ROLL NO.']),
    studentName: getRecordValue(record, config.colStudentName, ['STUDENT_NAME', 'STUDENT NAME', 'Student Name']),
    dob: getRecordValue(record, config.colDob, ['DATE OF BIRTH', 'DOB']),
    father: getRecordValue(record, config.colFather, ['FATHER_NAME', 'FATHER NAME', "FATHER'S NAME", 'Father Name']),
    mother: getRecordValue(record, config.colMother, ['MOTHER_NAME', 'MOTHER NAME', "MOTHER'S NAME", 'Mother Name']),
    college: getRecordValue(record, config.colCollege, ['COLLEGE NAME', 'College Name']),
    district: getRecordValue(record, config.colDistrict, ['DISTRICT', 'District']),
    testCentreName: getRecordValue(record, config.colTestCentreName, ['TEST_CENTRE_NAME', 'TEST CENTRE NAME', 'TEST CENTER NAME', 'Test Centre Name', 'Test Center Name']),
    testTime: formatDateTime(getRecordValue(record, config.colTestTime, ['Date and Time', 'DATE AND TIME', 'TEST TIME', 'Test Time'])),
    email: getRecordValue(record, config.colEmail, ['EMAIL', 'Email', 'Email Address']),
    status: getRecordValue(record, 'STATUS', ['Status']),
    dateTime: getRecordValue(record, 'DATE AND TIME', ['Date and Time']),
  };
}

export async function updateAirtableRecordStatus(config: any, recordId: string, webViewLink?: string) {
  const base = new Airtable({ apiKey: config.airtableToken }).base(config.airtableBaseId);
  const fieldsToUpdate: any = {
    'STATUS': config.statusSuccess,
    'DATE AND TIME': new Date().toISOString()
  };
  
  if (webViewLink) {
    fieldsToUpdate[config.colHallTicketUrl || 'Hall Ticket URL'] = webViewLink;
  }

  await base(config.airtableTable).update([
    {
      id: recordId,
      fields: fieldsToUpdate
    }
  ]);
}
