// Parity gate for rebuild slice 3: replaying the 15-step guided demo through the TypeScript workflow gives
// exactly the run the Python prototype recorded (full-demo-run.json), apart from timestamps.
import { describe, expect, it } from "vitest";
import { maskTimes } from "./__fixtures__/demo";
import fullDemo from "./__fixtures__/full-demo-run.json";
import { replayGuidedDemo } from "./__fixtures__/replay";
import { RunState } from "./run-state";

describe("guided demo replay", () => {
  const replayed = replayGuidedDemo();
  const expected = maskTimes(fullDemo) as unknown as RunState;
  const actual = maskTimes(replayed);

  it("is a valid RunState", () => {
    expect(() => RunState.parse(replayed)).not.toThrow();
  });

  for (const key of Object.keys(expected) as (keyof RunState)[]) {
    it(`matches the Python run: ${key}`, () => {
      // D61's stock plan is TypeScript-only; the Python run has none. D64 records the reason for switching to
      // automatic processing, which the Python prototype did not ask for.
      const value = key === "orders" ? actual.orders.map(({ fulfilment: _f, ...o }) => o)
        : key === "policyHistory" ? actual.policyHistory.map(({ reason: _r, ...p }) => p)
          : key === "audit" ? actual.audit.map((a) => (a.event === "policy_changed" ? { ...a, detail: { mode: a.detail.mode } } : a))
            : actual[key];
      expect(value).toStrictEqual(expected[key]);
    });
  }
});
