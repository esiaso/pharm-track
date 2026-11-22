/**
 * WHO ATC and PPB HPT code handling.
 *
 * ATC levels (WHO):
 *   1  anatomical main group      1 letter            A
 *   2  therapeutic subgroup       2 digits            A10
 *   3  pharmacological subgroup   1 letter            A10B
 *   4  chemical subgroup          1 letter            A10BA
 *   5  chemical substance         2 digits            A10BA02 (metformin)
 */
const ATC_PATTERNS: Record<number, RegExp> = {
  1: /^[A-Z]$/,
  2: /^[A-Z]\d{2}$/,
  3: /^[A-Z]\d{2}[A-Z]$/,
  4: /^[A-Z]\d{2}[A-Z]{2}$/,
  5: /^[A-Z]\d{2}[A-Z]{2}\d{2}$/,
};
const ATC_LENGTHS = [1, 3, 4, 5, 7];
const ATC_MAIN_GROUPS = new Set('ABCDGHJLMNPRSV'.split(''));

export function normaliseAtc(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}

/** Returns the ATC level (1..5) of a well-formed code, or null if it is not valid. */
export function atcLevel(code: string): number | null {
  const c = normaliseAtc(code);
  if (!ATC_MAIN_GROUPS.has(c[0] ?? '')) return null;
  for (const [level, re] of Object.entries(ATC_PATTERNS)) {
    if (re.test(c)) return Number(level);
  }
  return null;
}

export function isValidAtc(code: string, requiredLevel?: number): boolean {
  const level = atcLevel(code);
  return level !== null && (requiredLevel === undefined || level === requiredLevel);
}

/** All ancestors of a code, from level 1 up to and including the code itself. */
export function atcHierarchy(code: string): string[] {
  const c = normaliseAtc(code);
  const level = atcLevel(c);
  if (level === null) throw new Error(`Invalid ATC code: ${code}`);
  return ATC_LENGTHS.slice(0, level).map((len) => c.slice(0, len));
}

export function atcParent(code: string): string | null {
  const h = atcHierarchy(code);
  return h.length > 1 ? h[h.length - 2]! : null;
}

/** True when `code` sits under (or equals) the class `prefix`, e.g. J01CA04 is under J01C. */
export function atcMatches(prefix: string, code: string): boolean {
  return normaliseAtc(code).startsWith(normaliseAtc(prefix));
}

/** Level-4 chemical subgroup, used for duplicate-therapy checks. */
export function atcChemicalSubgroup(code: string): string {
  return normaliseAtc(code).slice(0, 5);
}

/** Antimicrobials for stewardship reporting: J01 antibacterials, J02 antimycotics, J04 antimycobacterials, J05 antivirals, P01 antiprotozoals. */
export function isAntimicrobial(code: string): boolean {
  return ['J01', 'J02', 'J04', 'J05', 'P01'].some((p) => atcMatches(p, code));
}

/**
 * PPB HPT code.
 *
 * ASSUMPTION: the published PPB HPT code format has not been confirmed for this
 * build, so validation is deliberately permissive by default (uppercase letters,
 * digits and . - / separators, 3 to 32 characters). Set HPT_CODE_PATTERN to the
 * exact regex once confirmed against the official code list. The authoritative
 * check is that the code exists in the imported HptCode table.
 */
const DEFAULT_HPT_PATTERN = /^[A-Z0-9][A-Z0-9.\-/]{2,31}$/;

export function normaliseHpt(code: string): string {
  return code.trim().toUpperCase();
}

export function isValidHptFormat(code: string, pattern: RegExp = hptPatternFromEnv()): boolean {
  return pattern.test(normaliseHpt(code));
}

export function hptPatternFromEnv(): RegExp {
  const p = process.env.HPT_CODE_PATTERN;
  return p ? new RegExp(p) : DEFAULT_HPT_PATTERN;
}
