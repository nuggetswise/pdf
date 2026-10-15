// Money guard: the domain code must never turn a value into a JavaScript number.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(__dirname);
const sources = readdirSync(DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

describe("lib/domain uses no float conversions", () => {
  for (const file of sources) {
    it(file, () => {
      const code = readFileSync(join(DIR, file), "utf8");
      expect(code).not.toMatch(/\bNumber\(|parseFloat\(|\.toFixed\(|Math\.round\(/);
    });
  }
});
