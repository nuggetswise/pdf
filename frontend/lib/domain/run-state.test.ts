import { describe, expect, it } from "vitest";
import fullDemoRun from "./__fixtures__/full-demo-run.json";
import { emptyRunState, RunState, runStateSizeBytes, SESSION_STORAGE_WARN_BYTES } from "./run-state";

// full-demo-run.json is the Python prototype's SQLite state after the 15-step guided demo
// (rehearsal mode, fictional fixtures), exported by scripts/export_run_state.py.
const exported = structuredClone(fullDemoRun) as unknown;

describe("RunState schema", () => {
  it("accepts the full guided-demo export without dropping or changing anything", () => {
    const parsed = RunState.parse(exported);
    expect(parsed).toEqual(exported);
  });

  it("carries every table of the demo run", () => {
    const s = RunState.parse(exported);
    expect(s.envelopes).toHaveLength(6);
    expect(s.documents.map((d) => d.status)).toContain("duplicate");
    expect(s.orders.map((o) => o.deliveryState)).toContain("erp_created");
    expect(s.erpOrders.length).toBeGreaterThan(0);
    expect(s.memoryRules[0].state).toBe("revoked");
    expect(s.deliveries.map((d) => d.state)).toContain("unknown");
    expect(s.policyHistory.map((p) => p.mode)).toEqual(expect.arrayContaining(["review_all", "exception_only"]));
    expect(s.documents.every((d) => d.pageText.length === d.pageCount)).toBe(true);
  });

  it("rejects money sent as a JSON number", () => {
    const tampered = structuredClone(exported) as RunState;
    (tampered.orders[0].validation.order.lines[0] as { unit_price: unknown }).unit_price = 24;
    expect(RunState.safeParse(tampered).success).toBe(false);

    const total = structuredClone(exported) as RunState;
    (total.erpOrders[0].payload.order.totals as { computed_total: unknown }).computed_total = 190.0;
    expect(RunState.safeParse(total).success).toBe(false);
  });

  it("rejects a malformed decimal string in a computed field", () => {
    const tampered = structuredClone(exported) as RunState;
    tampered.orders[0].validation.order.totals.computed_total = "1,90.00";
    expect(RunState.safeParse(tampered).success).toBe(false);
  });

  it("rejects unknown fields so typos cannot hide state", () => {
    const tampered = structuredClone(exported) as RunState & { orders: Array<Record<string, unknown>> };
    tampered.orders[0].approved = true;
    expect(RunState.safeParse(tampered).success).toBe(false);
  });

  it("rejects a review state outside the closed set", () => {
    const tampered = structuredClone(exported) as RunState;
    (tampered.orders[0] as { reviewState: string }).reviewState = "sent";
    expect(RunState.safeParse(tampered).success).toBe(false);
  });

  it("starts a fresh run in Review-all with bundled reference data", () => {
    const fresh = RunState.parse(emptyRunState("2026-10-15T15:00:00.000Z"));
    expect(fresh.policyHistory).toEqual([
      { id: 1, mode: "review_all", setBy: "system:order-agent", effectiveAt: "2026-10-15T15:00:00.000Z" },
    ]);
    expect(fresh.settings.referenceData).toBeNull();
  });

  it("fits comfortably in sessionStorage", () => {
    expect(runStateSizeBytes(RunState.parse(exported))).toBeLessThan(SESSION_STORAGE_WARN_BYTES / 10);
  });
});
