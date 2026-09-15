import { describe, expect, it } from 'vitest';
import { WeightParser } from '../src/indicator/parser.js';

const kg = () => new WeightParser({ unit: 'kg' });

describe('WeightParser — default pattern', () => {
  it('parses the Toledo/A&D style stable frame', () => {
    const reading = kg().parse('ST,GS,+  1234.5kg');
    expect(reading).toMatchObject({ weightKg: 1234.5, stable: true, fallback: false });
  });

  it('parses an unstable frame and reports it as unstable', () => {
    expect(kg().parse('US,GS,+00123.4 kg')).toMatchObject({ weightKg: 123.4, stable: false });
  });

  it('parses a bare zero-padded value', () => {
    expect(kg().parse('+0012345')).toMatchObject({ weightKg: 12345, fallback: false });
  });

  it('parses a plain decimal', () => {
    expect(kg().parse('8000.5')).toMatchObject({ weightKg: 8000.5 });
  });

  it('handles a comma decimal mark', () => {
    expect(kg().parse('ST,GS,1234,5kg')).toMatchObject({ weightKg: 1234.5 });
  });

  it('reports unknown stability as null rather than guessing', () => {
    // No status token at all — the indicator simply does not tell us.
    expect(kg().parse('12345')?.stable).toBeNull();
    // A status token we do not recognise is equally unknown.
    expect(kg().parse('ZZ,GS,12345')?.stable).toBeNull();
  });

  it('ignores blank lines', () => {
    expect(kg().parse('')).toBeNull();
    expect(kg().parse('   \r')).toBeNull();
  });

  it('handles negative readings from an untared platform', () => {
    expect(kg().parse('ST,GS,-0000120')?.weightKg).toBe(-120);
  });
});

describe('WeightParser — units', () => {
  it('normalises grams to kg', () => {
    expect(new WeightParser({ unit: 'g' }).parse('1500000')?.weightKg).toBe(1500);
  });

  it('normalises tons to kg', () => {
    expect(new WeightParser({ unit: 't' }).parse('12.5')?.weightKg).toBe(12500);
  });

  it('normalises pounds to kg without leaving float dust', () => {
    // 1000 lb = 453.59237 kg, rounded to the gram.
    expect(new WeightParser({ unit: 'lb' }).parse('1000')?.weightKg).toBe(453.592);
  });

  it('lets a unit in the line override the configured default', () => {
    expect(new WeightParser({ unit: 'kg' }).parse('ST,GS,2500g')?.weightKg).toBe(2.5);
  });
});

describe('WeightParser — custom pattern', () => {
  it('accepts a vendor pattern supplied through SERIAL_PATTERN', () => {
    // A fictional protocol: `W<weight>|<status>`
    const parser = new WeightParser({
      unit: 'kg',
      pattern: '^W(?<weight>\\d+)\\|(?<status>OK|MOVING)$',
      stableTokens: ['OK'],
      unstableTokens: ['MOVING'],
    });
    expect(parser.parse('W18500|OK')).toMatchObject({ weightKg: 18500, stable: true });
    expect(parser.parse('W18500|MOVING')).toMatchObject({ weightKg: 18500, stable: false });
  });

  it('fails loudly on an unparseable pattern rather than at runtime', () => {
    expect(() => new WeightParser({ unit: 'kg', pattern: '([' })).toThrow(/Invalid SERIAL_PATTERN/);
  });
});

describe('WeightParser — lenient fallback', () => {
  it('recovers a number from a line the pattern does not match', () => {
    const parser = new WeightParser({ unit: 'kg', pattern: '^NOPE(?<weight>\\d+)$' });
    const reading = parser.parse('garbage 4321 trailing');
    expect(reading).toMatchObject({ weightKg: 4321, fallback: true });
  });

  it('never claims stability for a fallback reading', () => {
    const parser = new WeightParser({ unit: 'kg', pattern: '^NOPE(?<weight>\\d+)$' });
    expect(parser.parse('ST,GS,4321 junk')?.stable).toBeNull();
  });

  it('drops the line entirely when lenient mode is off', () => {
    const parser = new WeightParser({
      unit: 'kg',
      pattern: '^NOPE(?<weight>\\d+)$',
      lenient: false,
    });
    expect(parser.parse('garbage 4321')).toBeNull();
  });
});
