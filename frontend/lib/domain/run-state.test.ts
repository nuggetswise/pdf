import { describe, expect, it } from "vitest";
import { forward, mapleRun, tickClock } from "./__fixtures__/maple";
import { emptyRunState, RunState, runStateSizeBytes, SESSION_STORAGE_WARN_BYTES } from "./run-state";

// A run the screens could produce: the milk and cheese POs delivered to the ERP, then the milk email received again
// (an identical file, so a duplicate). Fictional Maple fixtures.
const clock = tickClock(Date.parse("2026-10-16T09:00:00.000Z"));
const exported = JSON.parse(JSON.stringify(forward(mapleRun(), "milk", clock).state)) as unknown;

describe("RunState schema", () => {
  it("accepts a complete Maple run without dropping or changing anything", () => {
    const parsed = RunState.parse(exported);
    expect(parsed).toEqual(exported);
  });

  it("carries every table of the run", () => {
    const s = RunState.parse(exported);
    expect(s.envelopes).toHaveLength(3);
    expect(s.documents.map((d) => d.status)).toContain("duplicate");
    expect(s.orders.map((o) => o.deliveryState)).toContain("erp_created");
    expect(s.erpOrders.length).toBeGreaterThan(0);
    expect(s.policyHistory.map((p) => p.mode)).toEqual(["review_all"]);
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
