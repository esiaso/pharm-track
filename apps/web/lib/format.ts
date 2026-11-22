export const n = (v: string | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

export function date(v: string | null | undefined): string {
  if (!v) return '–';
  return new Date(v).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Nairobi' });
}

export function dateTime(v: string | null | undefined): string {
  if (!v) return '–';
  return new Date(v).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' });
}

export const label = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

/** Recall classes arrive as e.g. "CLASS_II"; show "Class II". */
export const recallClass = (s: string) => s.replace(/^class[_\s-]*/i, 'Class ').toUpperCase().replace(/^CLASS /, 'Class ');
