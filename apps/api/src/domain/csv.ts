/**
 * Small RFC 4180 CSV reader for content imports (WHO ATC/DDD, PPB HPT, rule
 * sets, formularies). Handles a UTF-8 BOM, quoted fields with embedded commas,
 * quotes and newlines, CRLF line ends, and comma, semicolon or tab delimiters
 * (detected from the header line, since spreadsheets exported with a European
 * locale use semicolons).
 */
export interface CsvRecord {
  /** 1-based line number in the file where the record starts (header is line 1). */
  line: number;
  /** Values keyed by normalised header name. */
  values: Record<string, string>;
}

export interface CsvTable {
  headers: string[];
  records: CsvRecord[];
}

/** Lower case, trimmed, with spaces, dots, dashes and slashes collapsed to `_`. */
export function normaliseHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s.\-/]+/g, '_').replace(/^_+|_+$/g, '');
}

function detectDelimiter(firstLine: string): string {
  const counts = [',', ';', '\t'].map((d) => ({ d, n: countOutsideQuotes(firstLine, d) }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0]!.n > 0 ? counts[0]!.d : ',';
}

function countOutsideQuotes(s: string, ch: string): number {
  let n = 0;
  let q = false;
  for (const c of s) {
    if (c === '"') q = !q;
    else if (c === ch && !q) n++;
  }
  return n;
}

export function parseCsv(text: string): CsvTable {
  const src = text.replace(/^﻿/, '');
  const firstLineEnd = src.search(/\r?\n/);
  const delim = detectDelimiter(firstLineEnd === -1 ? src : src.slice(0, firstLineEnd));
  const rows: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let rowStart = 1;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else {
        if (c === '\n') line++;
        cell += c;
      }
      continue;
    }
    if (c === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (c === delim) {
      cells.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      cells.push(cell);
      rows.push({ line: rowStart, cells });
      cells = [];
      cell = '';
      line++;
      rowStart = line;
    } else cell += c;
  }
  if (cell !== '' || cells.length) {
    cells.push(cell);
    rows.push({ line: rowStart, cells });
  }
  const nonEmpty = rows.filter((r) => r.cells.some((c) => c.trim() !== ''));
  if (!nonEmpty.length) return { headers: [], records: [] };
  const headers = nonEmpty[0]!.cells.map(normaliseHeader);
  const records = nonEmpty.slice(1).map((r) => ({
    line: r.line,
    values: Object.fromEntries(headers.map((h, i) => [h, (r.cells[i] ?? '').trim()])),
  }));
  return { headers, records };
}

/** Quote a value for CSV output. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: Record<string, unknown>[]): string {
  return [headers.join(','), ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(','))].join('\r\n') + '\r\n';
}
