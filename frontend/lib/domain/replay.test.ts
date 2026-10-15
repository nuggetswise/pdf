// Parity gate for rebuild slice 3: replaying the 15-step guided demo through the TypeScript workflow gives
// exactly the run the Python prototype recorded (full-demo-run.json), apart from timestamps.
import { describe, expect, it } from "vitest";
import { ADMIN, REVIEWER, forward, maskTimes, tickClock } from "./__fixtures__/demo";
import fullDemo from "./__fixtures__/full-demo-run.json";
import { RunState, emptyRunState } from "./run-state";
import { approve, decide, resetDemo, retryDelivery, setDemoSetting, setPolicy, setRuleState } from "./workflow";

export function replayGuidedDemo(): RunState {
  const clock = tickClock();
  let s = resetDemo(emptyRunState(clock.now()), ADMIN, clock);
  s = setDemoSetting(s, "rehearsal_mode", "on", ADMIN, clock);
  s = setPolicy(s, "exception_only", ADMIN, clock);
  ({ state: s } = forward(s, "VIDEO-DEMO-001", clock));
  s = decide(s, 1, { issueKey: "moq_violation:0", action: "one_off_exception",
    reason: "Customer confirmed a one-off trial quantity (fictional)" }, REVIEWER, clock);
  s = decide(s, 1, { issueKey: "price_mismatch:1", action: "accept_printed_price",
    reason: "Promotional price agreed by the account manager (fictional)" }, REVIEWER, clock);
  s = decide(s, 1, { issueKey: "outdated_identifier:2", action: "apply_mapping", params: { save_for_future: true } },
    REVIEWER, clock);
  s = setRuleState(s, 1, "active", ADMIN, null, clock);
  ({ state: s } = forward(s, "VIDEO-DEMO-002", clock));
  ({ state: s } = forward(s, "VIDEO-DEMO-003", clock));
  s = setRuleState(s, 1, "revoked", ADMIN, "Supplier withdrew the notice (fictional)", clock);
  ({ state: s } = forward(s, "VIDEO-DEMO-004", clock));
  s = setPolicy(s, "review_all", ADMIN, clock);
  ({ state: s } = forward(s, "VIDEO-DEMO-005", clock));
  s = setDemoSetting(s, "erp_failure_mode", "timeout_next", ADMIN, clock);
  s = approve(s, 5, REVIEWER, clock);
  s = retryDelivery(s, 5, REVIEWER, clock);
  ({ state: s } = forward(s, "VIDEO-DEMO-005", clock));
  return s;
}

describe("guided demo replay", () => {
  const replayed = replayGuidedDemo();
  const expected = maskTimes(fullDemo) as unknown as RunState;
  const actual = maskTimes(replayed);

  it("is a valid RunState", () => {
    expect(() => RunState.parse(replayed)).not.toThrow();
  });

  for (const key of Object.keys(expected) as (keyof RunState)[]) {
    it(`matches the Python run: ${key}`, () => {
      expect(actual[key]).toStrictEqual(expected[key]);
    });
  }
});
