// The 15 guided-demo steps as workflow calls, in the order the screens perform them (test helper).
import { ADMIN, REVIEWER, forward, tickClock } from "./demo";
import { type RunState, emptyRunState } from "../run-state";
import { approve, decide, resetDemo, retryDelivery, setDemoSetting, setPolicy, setRuleState } from "../workflow";

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
