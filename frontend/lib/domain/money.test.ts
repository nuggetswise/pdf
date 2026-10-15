// Deliberate differences from Python, recorded in DECISIONS.md D33. Everything else is covered by
// the parity test against the Python prototype.
import { describe, expect, it } from "vitest";
import { dec, Dec } from "./money";

describe("money edge cases", () => {
  it("treats NaN and Infinity as unreadable instead of carrying them into the checks", () => {
    for (const s of ["NaN", "nan", "-Infinity", "inf", "sNaN"]) expect(dec(s)).toBeNull();
  });
  it("refuses to divide by zero", () => {
    expect(() => Dec.of("1").div(Dec.of("0"))).toThrow("Division by zero");
  });
  it("rejects a non-number where our own code expects one", () => {
    expect(() => Dec.of("abc")).toThrow();
  });
});
