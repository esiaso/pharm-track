import { atcHierarchy, atcLevel, atcMatches, isAntimicrobial, isValidAtc, isValidHptFormat } from './codes';

describe('ATC codes', () => {
  it('detects each level', () => {
    expect(atcLevel('J')).toBe(1);
    expect(atcLevel('J01')).toBe(2);
    expect(atcLevel('J01C')).toBe(3);
    expect(atcLevel('J01CA')).toBe(4);
    expect(atcLevel('j01ca04')).toBe(5);
  });

  it('rejects malformed codes and unknown main groups', () => {
    expect(atcLevel('J1CA04')).toBeNull();
    expect(atcLevel('X01CA04')).toBeNull();
    expect(atcLevel('J01CA4')).toBeNull();
    expect(isValidAtc('J01CA', 5)).toBe(false);
  });

  it('builds the hierarchy', () => {
    expect(atcHierarchy('A10BA02')).toEqual(['A', 'A10', 'A10B', 'A10BA', 'A10BA02']);
  });

  it('matches classes by prefix', () => {
    expect(atcMatches('J01C', 'J01CA04')).toBe(true);
    expect(atcMatches('J01D', 'J01CA04')).toBe(false);
  });

  it('flags antimicrobials', () => {
    expect(isAntimicrobial('J01CA04')).toBe(true);
    expect(isAntimicrobial('A10BA02')).toBe(false);
  });
});

describe('HPT codes', () => {
  it('accepts plausible codes with the default pattern', () => {
    expect(isValidHptFormat('hpt-000123')).toBe(true);
  });
  it('rejects empty or odd input', () => {
    expect(isValidHptFormat('')).toBe(false);
    expect(isValidHptFormat('a b c')).toBe(false);
  });
  it('honours a custom pattern', () => {
    expect(isValidHptFormat('12345', /^\d{5}$/)).toBe(true);
    expect(isValidHptFormat('1234', /^\d{5}$/)).toBe(false);
  });
});
