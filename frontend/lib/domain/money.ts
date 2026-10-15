// Exact decimal arithmetic that behaves like Python's `decimal` module with its default context
// (28 significant digits, ROUND_HALF_EVEN), so TypeScript results match the Python prototype to the
// last character. A value keeps its exponent: "2.50" stays "2.50", as in Python.
//
// money() rounds to cents with ROUND_HALF_UP (DECISIONS.md D07). Nothing here ever uses a JavaScript
// number for a value; coefficients are BigInt.

const PREC = 28;

type Rounding = "half_up" | "half_even";

const pow10 = (n: number): bigint => 10n ** BigInt(n);
const digits = (c: bigint): number => (c === 0n ? 1 : c.toString().length);

/** Python's str.isspace() set, which is what Decimal() and str.strip() trim. */
const PY_SPACE = "\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const PY_STRIP = new RegExp(`^[${PY_SPACE}]+|[${PY_SPACE}]+$`, "gu");
export const pyStrip = (s: string): string => s.replace(PY_STRIP, "");
export const PY_WHITESPACE_RUN = new RegExp(`[${PY_SPACE}]+`, "gu");

/** Python accepts any Unicode decimal digit (e.g. Arabic-Indic). Nd digits come in aligned runs of ten. */
function asciiDigits(s: string): string | null {
  let out = "";
  for (const ch of s) {
    if (ch >= "0" && ch <= "9") { out += ch; continue; }
    if (!/^\p{Nd}$/u.test(ch)) return null;
    let cp = ch.codePointAt(0)!;
    let run = 0;
    while (/^\p{Nd}$/u.test(String.fromCodePoint(cp - 1))) { cp--; run++; }
    out += String(run % 10);
  }
  return out;
}

function roundCoef(coef: bigint, drop: number, mode: Rounding): bigint {
  if (drop <= 0) return coef;
  const div = pow10(drop);
  const q = coef / div;
  const r = coef % div;
  const twice = r * 2n;
  if (twice > div || (twice === div && (mode === "half_up" || q % 2n === 1n))) return q + 1n;
  return q;
}

export class Dec {
  private constructor(readonly sign: 0 | 1, readonly coef: bigint, readonly exp: number) {}

  /** Python Decimal(str): trims whitespace, ignores underscores. Returns "nonfinite" for NaN/Infinity. */
  static parse(raw: string): Dec | "nonfinite" | null {
    const s = pyStrip(raw).replace(/_/g, "");
    const special = /^([+-])?(inf|infinity|s?nan\d*)$/iu.exec(s);
    if (special) return "nonfinite";
    const m = /^([+-])?(\p{Nd}*)(?:\.(\p{Nd}*))?(?:[eE]([+-]?\p{Nd}+))?$/u.exec(s);
    if (!m) return null;
    const intPart = asciiDigits(m[2] ?? "");
    const fracPart = asciiDigits(m[3] ?? "");
    if (intPart === null || fracPart === null || intPart.length + fracPart.length === 0) return null;
    const expDigits = m[4] === undefined ? "0" : asciiDigits(m[4].replace(/^[+-]/, ""));
    if (expDigits === null) return null;
    const exp = (m[4]?.startsWith("-") ? -1 : 1) * Number.parseInt(expDigits, 10) - fracPart.length;
    return new Dec(m[1] === "-" ? 1 : 0, BigInt(intPart + fracPart), exp);
  }

  /** Decimal("...") on a value our own code or reference data produced; throws if it is not a number. */
  static of(s: string): Dec {
    const d = Dec.parse(s);
    if (!(d instanceof Dec)) throw new Error(`Not a finite decimal: ${s}`);
    return d;
  }

  static readonly ZERO = new Dec(0, 0n, 0);

  isZero(): boolean { return this.coef === 0n; }

  /** Python's context rounding after every arithmetic operation (28 digits, half-even). */
  private static fix(sign: 0 | 1, coef: bigint, exp: number): Dec {
    const n = digits(coef);
    if (n <= PREC) return new Dec(sign, coef, exp);
    let c = roundCoef(coef, n - PREC, "half_even");
    let e = exp + (n - PREC);
    if (digits(c) > PREC) { c /= 10n; e += 1; }
    return new Dec(sign, c, e);
  }

  private signed(): bigint { return this.sign ? -this.coef : this.coef; }

  add(o: Dec): Dec {
    const e = Math.min(this.exp, o.exp);
    const sum = this.signed() * pow10(this.exp - e) + o.signed() * pow10(o.exp - e);
    const sign: 0 | 1 = sum < 0n ? 1 : sum > 0n ? 0 : (this.sign && o.sign ? 1 : 0);
    return Dec.fix(sign, sum < 0n ? -sum : sum, e);
  }

  mul(o: Dec): Dec {
    return Dec.fix((this.sign ^ o.sign) as 0 | 1, this.coef * o.coef, this.exp + o.exp);
  }

  /** CPython's _pydecimal __truediv__: exact quotients keep the ideal exponent, others get 28 digits. */
  div(o: Dec): Dec {
    if (o.isZero()) throw new Error("Division by zero");
    const sign = (this.sign ^ o.sign) as 0 | 1;
    if (this.isZero()) return Dec.fix(sign, 0n, this.exp - o.exp);
    const shift = digits(o.coef) - digits(this.coef) + PREC + 1;
    let exp = this.exp - o.exp - shift;
    let coef: bigint;
    let rem: bigint;
    if (shift >= 0) { coef = (this.coef * pow10(shift)) / o.coef; rem = (this.coef * pow10(shift)) % o.coef; }
    else { const d = o.coef * pow10(-shift); coef = this.coef / d; rem = this.coef % d; }
    if (rem !== 0n) {
      if (coef % 5n === 0n) coef += 1n;
    } else {
      const ideal = this.exp - o.exp;
      while (exp < ideal && coef % 10n === 0n) { coef /= 10n; exp += 1; }
    }
    return Dec.fix(sign, coef, exp);
  }

  cmp(o: Dec): -1 | 0 | 1 {
    const e = Math.min(this.exp, o.exp);
    const a = this.signed() * pow10(this.exp - e);
    const b = o.signed() * pow10(o.exp - e);
    return a < b ? -1 : a > b ? 1 : 0;
  }
  lt(o: Dec): boolean { return this.cmp(o) < 0; }
  eq(o: Dec): boolean { return this.cmp(o) === 0; }

  /** Decimal.quantize(Decimal("1E<exp>"), rounding). */
  quantize(exp: number, mode: Rounding): Dec {
    if (exp <= this.exp) return new Dec(this.sign, this.coef * pow10(this.exp - exp), exp);
    return new Dec(this.sign, roundCoef(this.coef, exp - this.exp, mode), exp);
  }

  /** value == value.to_integral() */
  isIntegral(): boolean { return this.exp >= 0 || this.coef % pow10(-this.exp) === 0n; }

  normalize(): Dec {
    if (this.isZero()) return new Dec(this.sign, 0n, 0);
    let c = this.coef;
    let e = this.exp;
    while (c % 10n === 0n) { c /= 10n; e += 1; }
    return Dec.fix(this.sign, c, e);
  }

  /** format(value, "f") */
  toFixedPoint(): string {
    const c = this.coef.toString();
    const s = this.sign ? "-" : "";
    if (this.exp >= 0) return s + c + "0".repeat(this.exp);
    const padded = c.padStart(-this.exp + 1, "0");
    return `${s}${padded.slice(0, this.exp)}.${padded.slice(this.exp)}`;
  }

  /** str(Decimal): Python's to-scientific-string. */
  toString(): string {
    const c = this.coef.toString();
    const left = this.exp + c.length;
    const dot = this.exp <= 0 && left > -6 ? left : 1;
    let intPart: string;
    let frac: string;
    if (dot <= 0) { intPart = "0"; frac = "." + "0".repeat(-dot) + c; }
    else if (dot >= c.length) { intPart = c + "0".repeat(dot - c.length); frac = ""; }
    else { intPart = c.slice(0, dot); frac = "." + c.slice(dot); }
    const e = left === dot ? "" : `E${left - dot >= 0 ? "+" : ""}${left - dot}`;
    return (this.sign ? "-" : "") + intPart + frac + e;
  }
}

/** validation.py dec(): commas removed, blank or unreadable gives null. NaN and Infinity also give null
 *  (Python would keep them and then fail later; see DECISIONS.md D33). */
export function dec(value: string | null | undefined): Dec | null {
  if (value === null || value === undefined || value === "") return null;
  const d = Dec.parse(value.replace(/,/g, ""));
  return d instanceof Dec ? d : null;
}

/** Cents, ROUND_HALF_UP. */
export const money = (v: Dec): string => v.quantize(-2, "half_up").toString();

/** Quantities: whole numbers without trailing zeros, others exactly as held. */
export const qty = (v: Dec): string => (v.isIntegral() ? v.normalize().toFixedPoint() : v.toString());
