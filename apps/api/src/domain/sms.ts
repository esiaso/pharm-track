/** SMS template rendering and Kenyan phone-number normalisation. */

export const DEFAULT_TEMPLATES: Record<string, Record<string, string>> = {
  REFILL_REMINDER: {
    en: 'Hello {{patientFirstName}}, your {{drugName}} refill is due on {{dueDate}}. Please visit {{facilityName}} to collect it. Enquiries: {{facilityPhone}}.',
    sw: 'Habari {{patientFirstName}}, dawa yako ya {{drugName}} inafaa kuchukuliwa tena tarehe {{dueDate}}. Tafadhali fika {{facilityName}}. Maswali: {{facilityPhone}}.',
  },
  REFILL_DUE: {
    en: 'Hello {{patientFirstName}}, your {{drugName}} refill is due today. Please collect it at {{facilityName}}.',
    sw: 'Habari {{patientFirstName}}, leo ni siku ya kuchukua dawa yako ya {{drugName}}. Tafadhali fika {{facilityName}}.',
  },
  REFILL_OVERDUE: {
    en: 'Hello {{patientFirstName}}, your {{drugName}} refill was due on {{dueDate}}. Please collect it at {{facilityName}} so you do not miss doses.',
    sw: 'Habari {{patientFirstName}}, dawa yako ya {{drugName}} ilipaswa kuchukuliwa tarehe {{dueDate}}. Tafadhali fika {{facilityName}} usikose dozi.',
  },
  READY_FOR_COLLECTION: {
    en: 'Hello {{patientFirstName}}, your medication is ready for collection at {{facilityName}}.',
    sw: 'Habari {{patientFirstName}}, dawa yako iko tayari kuchukuliwa {{facilityName}}.',
  },
};

export function renderTemplate(body: string, vars: Record<string, string | undefined>): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? '');
}

/** Normalises Kenyan mobile numbers to E.164 (+2547XXXXXXXX / +2541XXXXXXXX). Returns null if invalid. */
export function normaliseKenyanMobile(raw: string): string | null {
  const digits = raw.replace(/[\s\-()]/g, '');
  const m = digits.match(/^\+?254([17]\d{8})$/) ?? digits.match(/^0([17]\d{8})$/) ?? digits.match(/^([17]\d{8})$/);
  return m ? `+254${m[1]}` : null;
}
