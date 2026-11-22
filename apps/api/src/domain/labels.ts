/**
 * Dispensing labels for Zebra printers (ZPL II).
 *
 * A label carries what the Pharmacy and Poisons Act asks for on a dispensed
 * medicine: the patient, the medicine and strength, the quantity, the
 * directions, the date, and the pharmacy's name and contact, plus the batch,
 * expiry and a "keep out of reach of children" line.
 *
 * Text is sent as UTF-8 (^CI28) with ^FH hex escapes, so names with accents or
 * Swahili text print, and ^ or ~ in free text cannot break the label.
 */

export interface LabelSize {
  widthMm: number;
  heightMm: number;
  dpi: 203 | 300 | 600;
}

export interface LabelData {
  facilityName: string;
  facilityPhone?: string | null;
  patient: string;
  medicine: string;
  quantity: string;
  directions: string;
  counselling?: string | null;
  batchNumber: string;
  expiryDate: Date;
  dispensedAt: Date;
  dispensedBy: string;
  reference: string;
  controlled?: boolean;
}

export const DEFAULT_LABEL_SIZE: LabelSize = { widthMm: 76, heightMm: 51, dpi: 203 };

export function labelSizeFromEnv(env: Record<string, string | undefined> = process.env): LabelSize {
  const w = Number(env.LABEL_WIDTH_MM || DEFAULT_LABEL_SIZE.widthMm);
  const h = Number(env.LABEL_HEIGHT_MM || DEFAULT_LABEL_SIZE.heightMm);
  const dpi = Number(env.LABEL_DPI || DEFAULT_LABEL_SIZE.dpi);
  if (!(w >= 50 && w <= 120) || !(h >= 45 && h <= 200)) throw new Error('LABEL_WIDTH_MM must be 50 to 120 and LABEL_HEIGHT_MM 45 to 200 (the label needs about 42 mm of height).');
  if (![203, 300, 600].includes(dpi)) throw new Error('LABEL_DPI must be 203, 300 or 600.');
  return { widthMm: w, heightMm: h, dpi: dpi as LabelSize['dpi'] };
}

/** Escapes text for a ^FH_ field: _ ^ ~ and control characters become _XX hex. */
export function zplText(s: string): string {
  return s
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[_^~\\\x00-\x1f]/g, (c) => `_${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)
    .trim();
}

/** Date as "22 Nov 2026" (labels are read by patients; no ambiguous numeric dates). */
export function labelDate(d: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // Nairobi time (UTC+3, no daylight saving).
  const t = new Date(d.getTime() + 3 * 3_600_000);
  return `${t.getUTCDate()} ${months[t.getUTCMonth()]} ${t.getUTCFullYear()}`;
}

/** Builds one ZPL label. `copies` prints the same label several times (^PQ). */
export function zplLabel(data: LabelData, size: LabelSize = DEFAULT_LABEL_SIZE, copies = 1): string {
  const dots = (mm: number) => Math.round((mm / 25.4) * size.dpi);
  const width = dots(size.widthMm);
  const height = dots(size.heightMm);
  const margin = dots(2);
  const inner = width - 2 * margin;
  const scale = size.dpi / 203;
  const font = (pt: number) => Math.round(pt * scale);

  const out: string[] = ['^XA', '^CI28', `^PW${width}`, `^LL${height}`, '^LH0,0'];
  let y = margin;
  const text = (s: string, h: number, opts: { lines?: number; bold?: boolean; align?: 'L' | 'C' | 'R' } = {}) => {
    if (!s) return;
    const lines = opts.lines ?? 1;
    const fh = font(h);
    out.push(`^FO${margin},${y}^A0N,${fh},${opts.bold ? Math.round(fh * 1.05) : fh}^FB${inner},${lines},2,${opts.align ?? 'L'}^FH_^FD${zplText(s)}^FS`);
    y += lines * (fh + 2) + font(4);
  };
  const rule = () => {
    out.push(`^FO${margin},${y}^GB${inner},2,2^FS`);
    y += font(6);
  };

  text([data.facilityName, data.facilityPhone ? `Tel ${data.facilityPhone}` : ''].filter(Boolean).join('  '), 20, { bold: true, align: 'C' });
  rule();
  text(`For: ${data.patient}`, 22, { bold: true });
  text(`${data.medicine}  x${data.quantity}`, 26, { bold: true, lines: 2 });
  text(data.directions, 22, { lines: 3 });
  if (data.counselling) text(data.counselling, 18, { lines: 2 });
  text(`${data.controlled ? 'CONTROLLED DRUG. ' : ''}Keep out of reach of children.`, 18, { bold: true });
  text(`Batch ${data.batchNumber}  Exp ${labelDate(data.expiryDate)}`, 18);
  text(`Dispensed ${labelDate(data.dispensedAt)} by ${data.dispensedBy}  Ref ${data.reference}`, 16);

  out.push(`^FXcontent ends at ${y}^FS`);
  if (copies > 1) out.push(`^PQ${Math.min(copies, 20)}`);
  out.push('^XZ');
  return out.join('\n');
}

/** True when the printed content ends inside the label. */
export function zplFits(zpl: string): boolean {
  const ll = Number(/\^LL(\d+)/.exec(zpl)?.[1] ?? 0);
  const end = Number(/\^FXcontent ends at (\d+)/.exec(zpl)?.[1] ?? Infinity);
  return end <= ll;
}

/** Printers per store from LABEL_PRINTERS, e.g. {"STORE-OPD":"10.0.5.20:9100"}. */
export function printersFromEnv(env: Record<string, string | undefined> = process.env): Record<string, { host: string; port: number }> {
  const raw = env.LABEL_PRINTERS;
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('LABEL_PRINTERS must be JSON, e.g. {"STORE-OPD":"10.0.5.20:9100"}.');
  }
  const out: Record<string, { host: string; port: number }> = {};
  for (const [store, addr] of Object.entries(parsed as Record<string, unknown>)) {
    const m = typeof addr === 'string' ? /^([A-Za-z0-9.\-]+)(?::(\d{1,5}))?$/.exec(addr) : null;
    if (!m) throw new Error(`LABEL_PRINTERS: "${String(addr)}" for ${store} is not host or host:port.`);
    out[store] = { host: m[1], port: m[2] ? Number(m[2]) : 9100 };
  }
  return out;
}
