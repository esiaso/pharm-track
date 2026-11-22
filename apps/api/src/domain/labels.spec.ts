import { directions } from '../dispensing/labels.service';
import { labelDate, labelSizeFromEnv, printersFromEnv, zplFits, zplLabel, zplText } from './labels';

const data = {
  facilityName: 'Kisumu County Referral Hospital Pharmacy',
  facilityPhone: '0700 000 000',
  patient: 'PAT-1',
  medicine: 'Amoxicillin 500 mg capsule',
  quantity: '21 capsules',
  directions: 'Take 1 capsule three times a day for 7 days. Finish the course.',
  counselling: 'Take with water. Return if a rash appears.',
  batchNumber: 'B1^~',
  expiryDate: new Date('2028-01-31T00:00:00Z'),
  dispensedAt: new Date('2026-11-22T20:30:00Z'), // 23:30 in Nairobi
  dispensedBy: 'u-pharm-1',
  reference: 'CT-RX-1',
};

describe('Zebra labels', () => {
  it('builds a ZPL label sized for a 3x2 inch label at 203 dpi', () => {
    const z = zplLabel(data);
    expect(z.startsWith('^XA\n^CI28\n^PW607\n^LL408')).toBe(true);
    expect(z.endsWith('^XZ')).toBe(true);
    expect(z).toContain('^FDFor: PAT-1^FS');
    expect(z).toContain('Amoxicillin 500 mg capsule  x21 capsules');
    expect(z).toContain('Keep out of reach of children.');
    expect(z).toContain('Dispensed 22 Nov 2026'); // Nairobi date, not UTC
    expect(zplFits(z)).toBe(true);
  });

  it('escapes characters that would break ZPL and keeps UTF-8 text', () => {
    expect(zplText('B1^~_x\nnext')).toBe('B1_5E_7E_5Fx next');
    expect(zplText('Kunywa vidonge 2 – asubuhi')).toBe('Kunywa vidonge 2 – asubuhi');
    expect(zplLabel(data)).toContain('Batch B1_5E_7E');
  });

  it('marks controlled drugs and repeats copies', () => {
    const z = zplLabel({ ...data, controlled: true }, undefined, 3);
    expect(z).toContain('CONTROLLED DRUG. Keep out of reach of children.');
    expect(z).toContain('^PQ3');
  });

  it('scales to 300 dpi and other sizes from settings', () => {
    const size = labelSizeFromEnv({ LABEL_WIDTH_MM: '100', LABEL_HEIGHT_MM: '50', LABEL_DPI: '300' });
    const z = zplLabel(data, size);
    expect(z).toContain('^PW1181');
    expect(zplFits(z)).toBe(true);
    expect(() => labelSizeFromEnv({ LABEL_DPI: '150' })).toThrow();
  });

  it('reads printers per store', () => {
    expect(printersFromEnv({ LABEL_PRINTERS: '{"STORE-1":"10.0.5.20","STORE-2":"zebra-opd.local:6101"}' })).toEqual({
      'STORE-1': { host: '10.0.5.20', port: 9100 },
      'STORE-2': { host: 'zebra-opd.local', port: 6101 },
    });
    expect(() => printersFromEnv({ LABEL_PRINTERS: '{"S":"http://x"}' })).toThrow();
    expect(printersFromEnv({})).toEqual({});
  });

  it('drops the medicine name from the stored label text', () => {
    expect(directions('Amoxicillin 500 mg. 500 mg TDS for 7 days', 'Amoxicillin', '500 mg')).toBe('500 mg TDS for 7 days');
    expect(directions('Take one daily', 'Amoxicillin', '500 mg')).toBe('Take one daily');
    expect(labelDate(new Date('2026-01-01T00:00:00Z'))).toBe('1 Jan 2026');
  });
});
