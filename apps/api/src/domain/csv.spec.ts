import { parseCsv, toCsv } from './csv';

describe('parseCsv', () => {
  it('reads quoted fields, embedded commas, quotes and newlines, and BOM', () => {
    const t = parseCsv('﻿ATC code,Name,Note\r\nA10BA02,"metformin, oral","say ""hi""\nthere"\r\nN02BE01,paracetamol,\r\n');
    expect(t.headers).toEqual(['atc_code', 'name', 'note']);
    expect(t.records).toEqual([
      { line: 2, values: { atc_code: 'A10BA02', name: 'metformin, oral', note: 'say "hi"\nthere' } },
      { line: 4, values: { atc_code: 'N02BE01', name: 'paracetamol', note: '' } },
    ]);
  });

  it('detects semicolon and tab delimiters and skips blank lines', () => {
    expect(parseCsv('a;b\n1;2,5\n\n').records).toEqual([{ line: 2, values: { a: '1', b: '2,5' } }]);
    expect(parseCsv('a\tb\nx\ty').records[0]!.values).toEqual({ a: 'x', b: 'y' });
  });

  it('normalises headers like "Adm.R" and "HPT Code"', () => {
    expect(parseCsv('Adm.R,HPT Code, DDD unit \n').headers).toEqual(['adm_r', 'hpt_code', 'ddd_unit']);
  });

  it('round-trips through toCsv', () => {
    const csv = toCsv(['a', 'b'], [{ a: 'x,y', b: 'q"z' }]);
    expect(parseCsv(csv).records[0]!.values).toEqual({ a: 'x,y', b: 'q"z' });
  });
});
