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

/** Placeholders a template may use. */
export const PLACEHOLDERS = ['patientFirstName', 'drugName', 'dueDate', 'facilityName', 'facilityPhone'] as const;

/**
 * Wording that does not name the medicine, for facilities that want SMS to
 * reveal nothing about a patient's treatment on a shared phone (Data
 * Protection Act review, open item 3).
 */
export const PRIVATE_TEMPLATES: Record<string, Record<string, string>> = {
  REFILL_REMINDER: {
    en: 'Hello {{patientFirstName}}, you have a pharmacy collection due on {{dueDate}} at {{facilityName}}. Enquiries: {{facilityPhone}}.',
    sw: 'Habari {{patientFirstName}}, una dawa ya kuchukua tarehe {{dueDate}} katika {{facilityName}}. Maswali: {{facilityPhone}}.',
  },
  REFILL_DUE: {
    en: 'Hello {{patientFirstName}}, you have a pharmacy collection due today at {{facilityName}}.',
    sw: 'Habari {{patientFirstName}}, leo una dawa ya kuchukua katika {{facilityName}}.',
  },
  REFILL_OVERDUE: {
    en: 'Hello {{patientFirstName}}, your pharmacy collection was due on {{dueDate}}. Please visit {{facilityName}}.',
    sw: 'Habari {{patientFirstName}}, ulipaswa kuchukua dawa tarehe {{dueDate}}. Tafadhali fika {{facilityName}}.',
  },
  READY_FOR_COLLECTION: DEFAULT_TEMPLATES.READY_FOR_COLLECTION,
};

/** Placeholders in a template body that are not in PLACEHOLDERS. */
export function unknownPlaceholders(body: string): string[] {
  const found = [...body.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]);
  return [...new Set(found.filter((k) => !(PLACEHOLDERS as readonly string[]).includes(k)))];
}

export function renderTemplate(body: string, vars: Record<string, string | undefined>): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? '');
}

/** Normalises Kenyan mobile numbers to E.164 (+2547XXXXXXXX / +2541XXXXXXXX). Returns null if invalid. */
export function normaliseKenyanMobile(raw: string): string | null {
  const digits = raw.replace(/[\s\-()]/g, '');
  const m = digits.match(/^\+?254([17]\d{8})$/) ?? digits.match(/^0([17]\d{8})$/) ?? digits.match(/^([17]\d{8})$/);
  return m ? `+254${m[1]}` : null;
}
