/**
 * Parsing and validation of clinical content files (phase 4). Pure functions:
 * each parser takes CSV text and returns the valid rows plus per-line errors,
 * so the API can show a dry run before anything is written.
 *
 * Column names are matched case-insensitively and with common aliases, so the
 * WHO ATC/DDD index export ("ATC code", "ATC level name", "DDD", "U", "Adm.R",
 * "Note") and PharmTrack's own templates both load without editing.
 */
import { atcLevel, isValidHptFormat, normaliseAtc, normaliseHpt } from './codes';
import { CsvRecord, parseCsv } from './csv';

export type ContentKind = 'atc' | 'hpt' | 'interactions' | 'contraindications' | 'dose-limits' | 'facility-formulary' | 'drugs';
export const CONTENT_KINDS: ContentKind[] = ['atc', 'hpt', 'interactions', 'contraindications', 'dose-limits', 'facility-formulary', 'drugs'];

export interface RowError {
  line: number;
  message: string;
}
export interface Parsed<T> {
  rows: (T & { line: number })[];
  errors: RowError[];
}

// ── Column handling ─────────────────────────────────────────────────────────

type Spec = Record<string, { aliases: string[]; required?: boolean }>;

const col = (aliases: string[], required = false) => ({ aliases, required });

function resolveColumns(headers: string[], spec: Spec): { map: Record<string, string | undefined>; missing: string[] } {
  const map: Record<string, string | undefined> = {};
  const missing: string[] = [];
  for (const [key, { aliases, required }] of Object.entries(spec)) {
    const found = aliases.find((a) => headers.includes(a));
    map[key] = found;
    if (!found && required) missing.push(aliases[0]!);
  }
  return { map, missing };
}

function read<T>(text: string, spec: Spec, each: (get: (k: string) => string, rec: CsvRecord) => T | string | string[]): Parsed<T> {
  const table = parseCsv(text);
  if (!table.headers.length) return { rows: [], errors: [{ line: 1, message: 'The file is empty.' }] };
  const { map, missing } = resolveColumns(table.headers, spec);
  if (missing.length) return { rows: [], errors: [{ line: 1, message: `Missing column(s): ${missing.join(', ')}` }] };
  const rows: (T & { line: number })[] = [];
  const errors: RowError[] = [];
  for (const rec of table.records) {
    const get = (k: string) => (map[k] ? rec.values[map[k]!] ?? '' : '');
    const out = each(get, rec);
    if (typeof out === 'string') errors.push({ line: rec.line, message: out });
    else if (Array.isArray(out)) out.forEach((m) => errors.push({ line: rec.line, message: m }));
    else rows.push({ ...out, line: rec.line });
  }
  return { rows, errors };
}

/** Accepts "1.5" and "1,5" (European decimal comma). Empty gives undefined. */
export function parseNumber(v: string): number | undefined | null {
  if (v.trim() === '') return undefined;
  const n = Number(v.trim().replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function parseBool(v: string): boolean | undefined | null {
  const s = v.trim().toLowerCase();
  if (s === '') return undefined;
  if (['y', 'yes', 'true', '1'].includes(s)) return true;
  if (['n', 'no', 'false', '0'].includes(s)) return false;
  return null;
}

const upper = (v: string) => v.trim().toUpperCase().replace(/[\s-]+/g, '_');
const opt = (v: string) => (v.trim() === '' ? undefined : v.trim());

/** `fallback` undefined: required. null: optional with no default. */
function enumValue<T extends string>(v: string, allowed: readonly T[], field: string, errs: string[], fallback?: T | null): T | undefined {
  if (v.trim() === '') {
    if (fallback === undefined) errs.push(`${field} is required`);
    return fallback ?? undefined;
  }
  const u = upper(v) as T;
  if (!allowed.includes(u)) {
    errs.push(`${field} "${v}" must be one of ${allowed.join(', ')}`);
    return undefined;
  }
  return u;
}

function num(v: string, field: string, errs: string[], opts: { int?: boolean; positive?: boolean } = {}): number | undefined {
  const n = parseNumber(v);
  if (n === null) errs.push(`${field} "${v}" is not a number`);
  else if (n !== undefined) {
    if (opts.int && !Number.isInteger(n)) errs.push(`${field} must be a whole number`);
    if (opts.positive && n <= 0) errs.push(`${field} must be greater than 0`);
    else if (n < 0) errs.push(`${field} cannot be negative`);
    return n;
  }
  return undefined;
}

function bool(v: string, field: string, errs: string[]): boolean | undefined {
  const b = parseBool(v);
  if (b === null) errs.push(`${field} "${v}" must be yes or no`);
  return b ?? undefined;
}

function atcPrefix(v: string, field: string, errs: string[]): string {
  const c = normaliseAtc(v);
  if (!c) errs.push(`${field} is required`);
  else if (atcLevel(c) === null) errs.push(`${field} "${v}" is not a valid ATC code or class`);
  return c;
}

// ── WHO ATC / DDD ───────────────────────────────────────────────────────────

export interface AtcDddRow {
  ddd: number;
  unit: string;
  route: string;
  note: string;
}
export interface AtcRow {
  code: string;
  name: string;
  ddds: AtcDddRow[];
}

const ATC_SPEC: Spec = {
  code: col(['atc_code', 'code', 'atc'], true),
  name: col(['atc_level_name', 'atc_name', 'name'], true),
  ddd: col(['ddd']),
  unit: col(['u', 'uom', 'unit', 'ddd_unit']),
  route: col(['adm_r', 'adm_route', 'route', 'ddd_route']),
  note: col(['note', 'notes', 'ddd_note']),
};

/**
 * WHO lists a substance once per DDD (one row per route or form), so rows with
 * the same code are merged. Continuation rows may leave the name blank.
 */
export function parseAtcCsv(text: string): Parsed<AtcRow> {
  const parsed = read<{ code: string; name: string; ddd?: AtcDddRow }>(text, ATC_SPEC, (get) => {
    const errs: string[] = [];
    const code = normaliseAtc(get('code'));
    if (!code) return 'ATC code is required';
    if (atcLevel(code) === null) return `"${get('code')}" is not a valid ATC code`;
    const ddd = num(get('ddd'), 'DDD', errs, { positive: true });
    const unit = get('unit').trim();
    const route = get('route').trim();
    if (ddd !== undefined && !unit) errs.push('DDD unit (U) is required when a DDD is given');
    if (ddd !== undefined && atcLevel(code) !== 5) errs.push('DDDs are only given for level-5 codes');
    if (errs.length) return errs;
    return { code, name: get('name').trim(), ddd: ddd !== undefined ? { ddd, unit, route, note: get('note').trim() } : undefined };
  });
  const byCode = new Map<string, AtcRow & { line: number }>();
  const errors = [...parsed.errors];
  for (const r of parsed.rows) {
    const existing = byCode.get(r.code);
    if (existing) {
      if (r.name && existing.name && r.name.toLowerCase() !== existing.name.toLowerCase()) {
        errors.push({ line: r.line, message: `${r.code} appears with two names ("${existing.name}", "${r.name}")` });
        continue;
      }
      if (r.ddd) existing.ddds.push(r.ddd);
    } else byCode.set(r.code, { code: r.code, name: r.name, ddds: r.ddd ? [r.ddd] : [], line: r.line });
  }
  const rows: (AtcRow & { line: number })[] = [];
  for (const r of byCode.values()) {
    if (!r.name) errors.push({ line: r.line, message: `${r.code} has no name` });
    else rows.push(r);
  }
  // Every code's parent must be in the file or already loaded; the service checks the latter.
  errors.sort((a, b) => a.line - b.line);
  return { rows, errors };
}

/** The DDD stored on the code itself: oral if WHO gives one, otherwise the first. */
export function primaryDdd(ddds: AtcDddRow[]): AtcDddRow | undefined {
  return ddds.find((d) => d.route.toUpperCase() === 'O') ?? ddds[0];
}

// ── PPB HPT ─────────────────────────────────────────────────────────────────

export interface HptRow {
  code: string;
  description: string;
  category?: string;
  ppbStatus?: string;
}

const HPT_SPEC: Spec = {
  code: col(['hpt_code', 'code', 'hpt', 'product_code'], true),
  description: col(['description', 'product_name', 'name', 'product'], true),
  category: col(['category', 'product_category', 'class']),
  ppbStatus: col(['ppb_status', 'status', 'registration_status']),
};

export function parseHptCsv(text: string): Parsed<HptRow> {
  const seen = new Set<string>();
  return read<HptRow>(text, HPT_SPEC, (get) => {
    const code = normaliseHpt(get('code'));
    if (!code) return 'HPT code is required';
    if (!isValidHptFormat(code)) return `"${get('code')}" does not match the HPT code format`;
    if (seen.has(code)) return `${code} appears more than once`;
    seen.add(code);
    const description = get('description').trim();
    if (!description) return `${code} has no description`;
    return { code, description, category: opt(get('category')), ppbStatus: get('ppbStatus') ? upper(get('ppbStatus')) : undefined };
  });
}

// ── Safety rules ────────────────────────────────────────────────────────────

export const INTERACTION_SEVERITIES = ['MINOR', 'MODERATE', 'MAJOR', 'CONTRAINDICATED'] as const;
export const ALERT_SEVERITIES = ['INFO', 'WARNING', 'HARD_STOP'] as const;
export const DIAGNOSIS_SYSTEMS = ['ICD10', 'ICD11'] as const;

export interface InteractionRow {
  atcPrefixA: string;
  atcPrefixB: string;
  severity: (typeof INTERACTION_SEVERITIES)[number];
  description: string;
  management?: string;
  externalRef?: string;
}

export function parseInteractionsCsv(text: string): Parsed<InteractionRow> {
  const seen = new Set<string>();
  return read<InteractionRow>(
    text,
    {
      a: col(['atc_a', 'atc_prefix_a', 'drug_a_atc'], true),
      b: col(['atc_b', 'atc_prefix_b', 'drug_b_atc'], true),
      severity: col(['severity'], true),
      description: col(['description', 'effect'], true),
      management: col(['management', 'action']),
      ref: col(['ref', 'reference', 'external_ref', 'id']),
    },
    (get) => {
      const errs: string[] = [];
      const a = atcPrefix(get('a'), 'ATC A', errs);
      const b = atcPrefix(get('b'), 'ATC B', errs);
      const severity = enumValue(get('severity'), INTERACTION_SEVERITIES, 'Severity', errs);
      const description = get('description').trim();
      if (!description) errs.push('Description is required');
      if (a && a === b) errs.push('ATC A and ATC B are the same');
      const key = [a, b].sort().join('|');
      if (!errs.length && seen.has(key)) errs.push(`The pair ${a} / ${b} appears more than once`);
      if (errs.length) return errs;
      seen.add(key);
      return { atcPrefixA: a, atcPrefixB: b, severity: severity!, description, management: opt(get('management')), externalRef: opt(get('ref')) };
    },
  );
}

export interface ContraindicationRow {
  atcPrefix: string;
  diagnosisSystem: (typeof DIAGNOSIS_SYSTEMS)[number];
  diagnosisPrefix: string;
  severity: (typeof ALERT_SEVERITIES)[number];
  rationale: string;
  externalRef?: string;
}

const ICD10 = /^[A-Z]\d{1,2}([0-9A-Z])?(\.[0-9A-Z]{1,4})?$/;
const ICD11 = /^[0-9A-Z]{1,4}(\.[0-9A-Z]{1,4})?$/;

export function parseContraindicationsCsv(text: string): Parsed<ContraindicationRow> {
  return read<ContraindicationRow>(
    text,
    {
      atc: col(['atc', 'atc_prefix', 'atc_code'], true),
      system: col(['diagnosis_system', 'icd_version', 'system']),
      code: col(['diagnosis_code', 'diagnosis_prefix', 'icd_code', 'icd'], true),
      severity: col(['severity'], true),
      rationale: col(['rationale', 'description', 'reason'], true),
      ref: col(['ref', 'reference', 'external_ref', 'id']),
    },
    (get) => {
      const errs: string[] = [];
      const atc = atcPrefix(get('atc'), 'ATC', errs);
      const system = enumValue(get('system'), DIAGNOSIS_SYSTEMS, 'Diagnosis system', errs, 'ICD10')!;
      const code = get('code').trim().toUpperCase();
      if (!code) errs.push('Diagnosis code is required');
      else if (!(system === 'ICD11' ? ICD11 : ICD10).test(code)) errs.push(`"${code}" is not a valid ${system} code or prefix`);
      const severity = enumValue(get('severity'), ALERT_SEVERITIES, 'Severity', errs);
      const rationale = get('rationale').trim();
      if (!rationale) errs.push('Rationale is required');
      if (errs.length) return errs;
      return { atcPrefix: atc, diagnosisSystem: system, diagnosisPrefix: code, severity: severity!, rationale, externalRef: opt(get('ref')) };
    },
  );
}

export interface DoseLimitRow {
  hptCode?: string;
  atcPrefix?: string;
  route?: string;
  minAgeMonths?: number;
  maxAgeMonths?: number;
  minWeightKg?: number;
  maxWeightKg?: number;
  crClBelow?: number;
  hepaticImpairment?: boolean;
  doseUnit: string;
  perKg: boolean;
  maxSingleDose?: number;
  maxDailyDose?: number;
  severity: (typeof ALERT_SEVERITIES)[number];
  note?: string;
  externalRef?: string;
}

export function parseDoseLimitsCsv(text: string): Parsed<DoseLimitRow> {
  return read<DoseLimitRow>(
    text,
    {
      hpt: col(['hpt_code', 'hpt']),
      atc: col(['atc', 'atc_prefix', 'atc_code']),
      route: col(['route']),
      minAge: col(['min_age_months']),
      maxAge: col(['max_age_months']),
      minWt: col(['min_weight_kg']),
      maxWt: col(['max_weight_kg']),
      crcl: col(['crcl_below', 'crcl_below_ml_min']),
      hepatic: col(['hepatic_impairment']),
      unit: col(['dose_unit', 'unit'], true),
      perKg: col(['per_kg']),
      single: col(['max_single_dose']),
      daily: col(['max_daily_dose']),
      severity: col(['severity']),
      note: col(['note', 'notes']),
      ref: col(['ref', 'reference', 'external_ref', 'id']),
    },
    (get) => {
      const errs: string[] = [];
      const hpt = get('hpt').trim() ? normaliseHpt(get('hpt')) : undefined;
      const atc = get('atc').trim() ? atcPrefix(get('atc'), 'ATC', errs) : undefined;
      if (!hpt && !atc) errs.push('Give either an HPT code (one product) or an ATC code (a substance or class)');
      if (hpt && atc) errs.push('Give an HPT code or an ATC code, not both');
      const r = {
        minAgeMonths: num(get('minAge'), 'Min age (months)', errs, { int: true }),
        maxAgeMonths: num(get('maxAge'), 'Max age (months)', errs, { int: true }),
        minWeightKg: num(get('minWt'), 'Min weight', errs),
        maxWeightKg: num(get('maxWt'), 'Max weight', errs),
        crClBelow: num(get('crcl'), 'CrCl below', errs, { positive: true }),
        maxSingleDose: num(get('single'), 'Max single dose', errs, { positive: true }),
        maxDailyDose: num(get('daily'), 'Max daily dose', errs, { positive: true }),
      };
      const hepaticImpairment = bool(get('hepatic'), 'Hepatic impairment', errs);
      const perKg = bool(get('perKg'), 'Per kg', errs) ?? false;
      const doseUnit = get('unit').trim();
      if (!doseUnit) errs.push('Dose unit is required');
      if (r.maxSingleDose === undefined && r.maxDailyDose === undefined) errs.push('Give a max single dose, a max daily dose, or both');
      if (r.maxSingleDose !== undefined && r.maxDailyDose !== undefined && r.maxSingleDose > r.maxDailyDose) errs.push('Max single dose is more than the max daily dose');
      if (r.minAgeMonths !== undefined && r.maxAgeMonths !== undefined && r.minAgeMonths > r.maxAgeMonths) errs.push('Min age is more than max age');
      if (r.minWeightKg !== undefined && r.maxWeightKg !== undefined && r.minWeightKg > r.maxWeightKg) errs.push('Min weight is more than max weight');
      const severity = enumValue(get('severity'), ALERT_SEVERITIES, 'Severity', errs, 'WARNING');
      if (errs.length) return errs;
      return { hptCode: hpt, atcPrefix: atc, route: get('route').trim() ? upper(get('route')) : undefined, ...r, hepaticImpairment, doseUnit, perKg, severity: severity!, note: opt(get('note')), externalRef: opt(get('ref')) };
    },
  );
}

// ── Facility formulary and drug master ──────────────────────────────────────

export const FORMULARY_STATUSES = ['ACTIVE', 'RESTRICTED', 'NON_FORMULARY', 'DISCONTINUED'] as const;
export const CONTROLLED_SCHEDULES = ['NONE', 'SCHEDULE_1', 'SCHEDULE_2', 'SCHEDULE_3', 'SCHEDULE_4', 'SCHEDULE_5'] as const;
export const REPRODUCTIVE_RISKS = ['UNKNOWN', 'SAFE', 'CAUTION', 'AVOID', 'CONTRAINDICATED'] as const;

export interface FacilityFormularyRow {
  hptCode: string;
  status: (typeof FORMULARY_STATUSES)[number];
  approvalRequiredBy?: string;
  restrictionNote?: string;
}

export function parseFacilityFormularyCsv(text: string): Parsed<FacilityFormularyRow> {
  const seen = new Set<string>();
  return read<FacilityFormularyRow>(
    text,
    {
      hpt: col(['hpt_code', 'hpt', 'code'], true),
      status: col(['status', 'formulary_status'], true),
      approval: col(['approval_required_by', 'approver']),
      note: col(['restriction_note', 'note', 'notes']),
    },
    (get) => {
      const errs: string[] = [];
      const hptCode = normaliseHpt(get('hpt'));
      if (!hptCode) errs.push('HPT code is required');
      else if (seen.has(hptCode)) errs.push(`${hptCode} appears more than once`);
      const status = enumValue(get('status'), FORMULARY_STATUSES, 'Status', errs);
      if (status === 'RESTRICTED' && !get('approval').trim()) errs.push('Restricted items need "approval_required_by"');
      if (errs.length) return errs;
      seen.add(hptCode);
      return { hptCode, status: status!, approvalRequiredBy: opt(get('approval')), restrictionNote: opt(get('note')) };
    },
  );
}

export interface DrugRow {
  hptCode: string;
  atcCode: string;
  genericName: string;
  /** Undefined when the column is blank (keep current brands on update). */
  brandNames?: string[];
  strength: string;
  strengthValue?: number;
  strengthUnit?: string;
  dosageForm: string;
  route: string;
  packSize: number;
  unitOfIssue: string;
  /** Optional columns left blank are undefined: an update keeps the current value, a new drug gets the default. */
  controlledSchedule?: (typeof CONTROLLED_SCHEDULES)[number];
  formularyStatus?: (typeof FORMULARY_STATUSES)[number];
  pregnancyRisk?: (typeof REPRODUCTIVE_RISKS)[number];
  lactationRisk?: (typeof REPRODUCTIVE_RISKS)[number];
}

export function parseDrugsCsv(text: string): Parsed<DrugRow> {
  const seen = new Set<string>();
  return read<DrugRow>(
    text,
    {
      hpt: col(['hpt_code', 'hpt'], true),
      atc: col(['atc_code', 'atc'], true),
      generic: col(['generic_name', 'generic', 'inn'], true),
      brands: col(['brand_names', 'brands']),
      strength: col(['strength'], true),
      strengthValue: col(['strength_value']),
      strengthUnit: col(['strength_unit']),
      form: col(['dosage_form', 'form'], true),
      route: col(['route'], true),
      pack: col(['pack_size'], true),
      unit: col(['unit_of_issue'], true),
      controlled: col(['controlled_schedule', 'schedule']),
      status: col(['formulary_status', 'status']),
      pregnancy: col(['pregnancy_risk']),
      lactation: col(['lactation_risk']),
    },
    (get) => {
      const errs: string[] = [];
      const hptCode = normaliseHpt(get('hpt'));
      if (!hptCode) errs.push('HPT code is required');
      else if (!isValidHptFormat(hptCode)) errs.push(`"${get('hpt')}" does not match the HPT code format`);
      else if (seen.has(hptCode)) errs.push(`${hptCode} appears more than once`);
      const atcCode = normaliseAtc(get('atc'));
      if (atcLevel(atcCode) !== 5) errs.push(`ATC "${get('atc')}" must be a level-5 (substance) code`);
      const genericName = get('generic').trim();
      if (genericName.length < 2) errs.push('Generic name is required');
      for (const [k, label] of [['strength', 'Strength'], ['form', 'Dosage form'], ['route', 'Route'], ['unit', 'Unit of issue']] as const)
        if (!get(k).trim()) errs.push(`${label} is required`);
      const packSize = num(get('pack'), 'Pack size', errs, { int: true, positive: true });
      if (packSize === undefined && get('pack').trim() === '') errs.push('Pack size is required');
      const strengthValue = num(get('strengthValue'), 'Strength value', errs, { positive: true });
      const controlledSchedule = enumValue(get('controlled'), CONTROLLED_SCHEDULES, 'Controlled schedule', errs, null);
      const formularyStatus = enumValue(get('status'), FORMULARY_STATUSES, 'Formulary status', errs, null);
      const pregnancyRisk = enumValue(get('pregnancy'), REPRODUCTIVE_RISKS, 'Pregnancy risk', errs, null);
      const lactationRisk = enumValue(get('lactation'), REPRODUCTIVE_RISKS, 'Lactation risk', errs, null);
      if (errs.length) return errs;
      seen.add(hptCode);
      return {
        hptCode,
        atcCode,
        genericName,
        brandNames: get('brands').trim() ? get('brands').split(/[|;]/).map((b) => b.trim()).filter(Boolean) : undefined,
        strength: get('strength').trim(),
        strengthValue,
        strengthUnit: opt(get('strengthUnit')),
        dosageForm: upper(get('form')),
        route: upper(get('route')),
        packSize: packSize!,
        unitOfIssue: upper(get('unit')),
        controlledSchedule,
        formularyStatus,
        pregnancyRisk,
        lactationRisk,
      };
    },
  );
}

// ── Templates ───────────────────────────────────────────────────────────────

/** Header row and one illustrative row per kind, offered as a download. Example rows are format samples, not clinical guidance. */
export const TEMPLATES: Record<ContentKind, { headers: string[]; example: Record<string, string> }> = {
  atc: { headers: ['atc_code', 'atc_level_name', 'ddd', 'u', 'adm_r', 'note'], example: { atc_code: 'A10BA02', atc_level_name: 'metformin', ddd: '2', u: 'g', adm_r: 'O', note: '' } },
  hpt: { headers: ['hpt_code', 'description', 'category', 'ppb_status'], example: { hpt_code: 'EXAMPLE-0001', description: 'Metformin 500 mg tablet', category: 'Medicines', ppb_status: 'REGISTERED' } },
  interactions: {
    headers: ['atc_a', 'atc_b', 'severity', 'description', 'management', 'ref'],
    example: { atc_a: 'B01AA', atc_b: 'M01A', severity: 'MAJOR', description: 'Example: describe the interaction', management: 'Example: what the pharmacist should do', ref: 'SRC-1' },
  },
  contraindications: {
    headers: ['atc', 'diagnosis_system', 'diagnosis_code', 'severity', 'rationale', 'ref'],
    example: { atc: 'M01A', diagnosis_system: 'ICD10', diagnosis_code: 'K25', severity: 'HARD_STOP', rationale: 'Example: why it is contraindicated', ref: 'SRC-2' },
  },
  'dose-limits': {
    headers: ['hpt_code', 'atc', 'route', 'min_age_months', 'max_age_months', 'min_weight_kg', 'max_weight_kg', 'crcl_below', 'hepatic_impairment', 'dose_unit', 'per_kg', 'max_single_dose', 'max_daily_dose', 'severity', 'note', 'ref'],
    example: { hpt_code: '', atc: 'N02BE01', route: 'ORAL', min_age_months: '216', max_age_months: '', min_weight_kg: '', max_weight_kg: '', crcl_below: '', hepatic_impairment: '', dose_unit: 'mg', per_kg: 'no', max_single_dose: '1000', max_daily_dose: '4000', severity: 'WARNING', note: 'Example adult limit', ref: 'SRC-3' },
  },
  'facility-formulary': {
    headers: ['hpt_code', 'status', 'approval_required_by', 'restriction_note'],
    example: { hpt_code: 'EXAMPLE-0001', status: 'RESTRICTED', approval_required_by: 'CONSULTANT_MICROBIOLOGIST', restriction_note: 'Example: culture-guided use only' },
  },
  drugs: {
    headers: ['hpt_code', 'atc_code', 'generic_name', 'brand_names', 'strength', 'strength_value', 'strength_unit', 'dosage_form', 'route', 'pack_size', 'unit_of_issue', 'controlled_schedule', 'formulary_status', 'pregnancy_risk', 'lactation_risk'],
    example: { hpt_code: 'EXAMPLE-0001', atc_code: 'A10BA02', generic_name: 'Metformin', brand_names: 'Brand A|Brand B', strength: '500 mg', strength_value: '500', strength_unit: 'mg', dosage_form: 'TABLET', route: 'ORAL', pack_size: '100', unit_of_issue: 'TABLET', controlled_schedule: 'NONE', formulary_status: 'ACTIVE', pregnancy_risk: 'UNKNOWN', lactation_risk: 'UNKNOWN' },
  },
};

// ── Comparing rule sets (shown to the approving pharmacist) ─────────────────

export type RuleKind = 'INTERACTION' | 'CONTRAINDICATION' | 'DOSE_LIMIT';

type AnyRule = Record<string, unknown>;

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** What identifies "the same rule" across two versions of a rule set. */
export function ruleKey(kind: RuleKind, r: AnyRule): string {
  switch (kind) {
    case 'INTERACTION':
      return [s(r.atcPrefixA), s(r.atcPrefixB)].sort().join('|');
    case 'CONTRAINDICATION':
      return [s(r.atcPrefix), s(r.diagnosisSystem), s(r.diagnosisPrefix)].join('|');
    case 'DOSE_LIMIT':
      return [s(r.drugId ?? r.hptCode), s(r.atcPrefix), s(r.route), s(r.minAgeMonths), s(r.maxAgeMonths), s(r.minWeightKg), s(r.maxWeightKg), s(r.crClBelow), s(r.hepaticImpairment)].join('|');
  }
}

const COMPARED: Record<RuleKind, string[]> = {
  INTERACTION: ['severity', 'description', 'management'],
  CONTRAINDICATION: ['severity', 'rationale'],
  DOSE_LIMIT: ['doseUnit', 'perKg', 'maxSingleDose', 'maxDailyDose', 'severity', 'note'],
};

export interface RuleDiff {
  added: string[];
  removed: string[];
  changed: { key: string; fields: string[] }[];
  unchanged: number;
}

/** Numbers from the database arrive as Decimal objects; compare them as numbers. */
const norm = (v: unknown) => (v === null || v === undefined || v === '' ? '' : typeof v === 'object' ? String(Number(v)) : typeof v === 'number' ? String(v) : String(v).trim());

export function diffRules(kind: RuleKind, before: AnyRule[], after: AnyRule[]): RuleDiff {
  const prev = new Map(before.map((r) => [ruleKey(kind, r), r]));
  const next = new Map(after.map((r) => [ruleKey(kind, r), r]));
  const diff: RuleDiff = { added: [], removed: [], changed: [], unchanged: 0 };
  for (const [k, r] of next) {
    const p = prev.get(k);
    if (!p) diff.added.push(k);
    else {
      const fields = COMPARED[kind].filter((f) => norm(p[f]) !== norm(r[f]));
      if (fields.length) diff.changed.push({ key: k, fields });
      else diff.unchanged++;
    }
  }
  for (const k of prev.keys()) if (!next.has(k)) diff.removed.push(k);
  return diff;
}
