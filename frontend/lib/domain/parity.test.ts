// Parity gate for rebuild slice 2: the TypeScript port must produce exactly the bytes Python produces.
// The expected values come from scripts/validation_parity.py, which runs the Python prototype.
import { describe, expect, it } from "vitest";
import parity from "./__fixtures__/validation-parity.json";
import { dec, Dec, money, qty } from "./money";
import { normalise } from "./normalise";
import { pyJsonDumps } from "./pyjson";
import { type OtherOrder, type Overrides, type Reference, type RuleInput, validate } from "./validation";

type Case<I> = { name?: string; input: I; expected: string };
const data = parity as unknown as {
  refs: Record<string, Reference>;
  decimal: Case<string | [string, string]>[];
  normalise: Case<{ raw: Record<string, unknown>; pages: string[]; extractor: { name: string; is_ai: boolean } }>[];
  validate: Case<{ payload: string; ref: string; rules: RuleInput[] | null; overrides: Overrides | null; others: OtherOrder[] | null }>[];
};

describe("decimal helpers match Python's decimal module", () => {
  for (const c of data.decimal) {
    it(JSON.stringify(c.input), () => {
      let actual: unknown;
      if (typeof c.input === "string") {
        const d = dec(c.input);
        actual = d === null ? null : { str: d.toString(), money: money(d), qty: qty(d), integral: d.isIntegral() };
      } else {
        const [x, y] = c.input.map((s) => Dec.of(s));
        const q = x.div(y);
        actual = {
          add: x.add(y).toString(), mul: x.mul(y).toString(), div: q.toString(), lt: x.lt(y),
          q_even: q.quantize(-2, "half_even").toString(), money_div: money(q), qty_div: qty(q),
        };
      }
      expect(pyJsonDumps(actual)).toBe(c.expected);
    });
  }
});

describe("normalise() matches Python byte for byte", () => {
  for (const c of data.normalise) {
    it(c.name!, () => {
      const { raw, pages, extractor } = structuredClone(c.input);
      const out = normalise(raw, pages, { name: extractor.name, isAi: extractor.is_ai });
      expect(pyJsonDumps(out)).toBe(c.expected);
    });
  }
});

describe("validate() matches Python byte for byte", () => {
  const payloads = new Map(data.normalise.map((c) => [c.name!, JSON.parse(c.expected)]));
  for (const c of data.validate) {
    it(c.name!, () => {
      const { payload, ref, rules, overrides, others } = structuredClone(c.input);
      const out = validate(structuredClone(payloads.get(payload)), structuredClone(data.refs[ref]), rules, overrides, others);
      expect(pyJsonDumps(out)).toBe(c.expected);
    });
  }
});
