/**
 * Weight-line parser (brief §13-M1: "configurable parser").
 *
 * The client has not yet supplied the indicator's protocol spec, so the parser
 * is driven by config rather than hardcoded to one vendor. The default pattern
 * covers the two shapes almost every indicator in this class emits:
 *
 *   ST,GS,+  1234.5kg     — Toledo/A&D style: status, gross/net mode, value
 *   +0012345              — bare signed value, sometimes zero-padded
 *
 * When the real spec arrives, `SERIAL_PATTERN` takes a named-group regex and
 * nothing else has to change.
 */

export type WeightUnit = 'kg' | 'g' | 'lb' | 't';

/** Multipliers to kg. lb is the international avoirdupois pound. */
const UNIT_TO_KG: Record<WeightUnit, number> = {
  kg: 1,
  g: 0.001,
  lb: 0.45359237,
  t: 1000,
};

export const DEFAULT_WEIGHT_PATTERN =
  '^\\s*(?:(?<status>[A-Za-z]{2})\\s*,)?\\s*(?:(?<mode>[A-Za-z]{2})\\s*,)?\\s*(?<weight>[+-]?\\s*\\d+(?:[.,]\\d+)?)\\s*(?<unit>kg|g|lb|t)?\\s*$';

export interface ParserConfig {
  /** Named-group regex; must define `weight`, may define `status` and `unit`. */
  pattern?: string;
  /** Unit the indicator reports when the line itself doesn't say. */
  unit: WeightUnit;
  /** Status tokens that mean the reading has settled. */
  stableTokens?: string[];
  /** Status tokens that mean it has not. */
  unstableTokens?: string[];
  /**
   * If the pattern doesn't match, fall back to "first number on the line".
   * On by default: until the real protocol is known, a usable reading beats a
   * dropped one, and every fallback is counted so it shows up in the logs.
   */
  lenient?: boolean;
}

export interface ParsedReading {
  weightKg: number;
  /** `null` means this indicator doesn't report stability — not "unstable". */
  stable: boolean | null;
  raw: string;
  /** True when the lenient fallback produced this, not the pattern. */
  fallback: boolean;
}

const DEFAULT_STABLE_TOKENS = ['ST', 'S'];
const DEFAULT_UNSTABLE_TOKENS = ['US', 'U', 'MO'];

export class WeightParser {
  private readonly regex: RegExp;
  private readonly unit: WeightUnit;
  private readonly stableTokens: Set<string>;
  private readonly unstableTokens: Set<string>;
  private readonly lenient: boolean;

  constructor(config: ParserConfig) {
    const source = config.pattern?.trim() || DEFAULT_WEIGHT_PATTERN;
    try {
      this.regex = new RegExp(source);
    } catch (error) {
      throw new Error(`Invalid SERIAL_PATTERN: ${(error as Error).message}`);
    }
    this.unit = config.unit;
    this.stableTokens = new Set(
      (config.stableTokens ?? DEFAULT_STABLE_TOKENS).map((t) => t.toUpperCase()),
    );
    this.unstableTokens = new Set(
      (config.unstableTokens ?? DEFAULT_UNSTABLE_TOKENS).map((t) => t.toUpperCase()),
    );
    this.lenient = config.lenient ?? true;
  }

  parse(line: string): ParsedReading | null {
    const raw = line.trim();
    if (raw === '') return null;

    const match = this.regex.exec(raw);
    if (match?.groups?.['weight'] !== undefined) {
      const weightKg = this.toKg(match.groups['weight'], match.groups['unit']);
      if (weightKg === null) return null;
      return {
        weightKg,
        stable: this.toStable(match.groups['status']),
        raw,
        fallback: false,
      };
    }

    if (!this.lenient) return null;

    const loose = /[+-]?\d+(?:[.,]\d+)?/.exec(raw);
    if (!loose) return null;
    const weightKg = this.toKg(loose[0], undefined);
    if (weightKg === null) return null;
    // Stability is unknown here: a line we couldn't fully parse gives us no
    // trustworthy status token, and guessing "stable" would be dangerous.
    return { weightKg, stable: null, raw, fallback: true };
  }

  private toKg(rawWeight: string, rawUnit: string | undefined): number | null {
    // Indicators pad the sign away from the digits ("+  1234.5") and some use
    // a comma as the decimal mark.
    const normalised = rawWeight.replace(/\s+/g, '').replace(',', '.');
    const value = Number.parseFloat(normalised);
    if (!Number.isFinite(value)) return null;

    const unit = (rawUnit?.toLowerCase() as WeightUnit | undefined) ?? this.unit;
    const multiplier = UNIT_TO_KG[unit] ?? 1;
    const kg = value * multiplier;

    // Float dust from the lb/g multipliers would otherwise reach the receipt.
    return Math.round(kg * 1000) / 1000;
  }

  private toStable(status: string | undefined): boolean | null {
    if (status === undefined) return null;
    const token = status.toUpperCase();
    if (this.stableTokens.has(token)) return true;
    if (this.unstableTokens.has(token)) return false;
    return null;
  }
}
