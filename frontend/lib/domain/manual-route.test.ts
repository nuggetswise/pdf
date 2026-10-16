import { describe, expect, it } from "vitest";
import { replayGuidedDemo } from "./__fixtures__/replay";
import { DEFAULT_ASSUMPTIONS, manualRoute, manualRouteTotals, setManualRouteAssumptions } from "./manual-route";

const ADMIN = { actor: "demo:alex", role: "administrator" as const };
const REVIEWER = { actor: "demo:rita", role: "reviewer" as const };

describe("manual route (Act 1)", () => {
  const s = replayGuidedDemo();

  it("prices VIDEO-DEMO-001 from its errors and the default assumptions, in exact decimals", () => {
    const m = manualRoute(s, 1)!;
    expect(m.fields).toEqual({ order: 18, asn: 7, invoice: 5, total: 30 });
    expect(m.minutes).toBe("10.0"); // 30 fields x 20 s
    expect(m.labourCost).toBe("5.00"); // 10 min at 30.00 an hour
    expect(m.risks.map((r) => [r.label, r.amount])).toEqual([
      ["Line A", null], // MOQ: a loss, not a chargeback
      ["Line B", "4.00"], // printed 26.00 vs agreed 24.00, 2 cases short-paid
      ["Line C", "50.00"], // retired GTIN on the ASN
    ]);
    expect(m.lateAsnExposure).toBe("0.38"); // 190.00 x 2% x 10%
    expect(m.chargebackExposure).toBe("54.38");
    expect(m.expectedKeyingErrors).toBe("0.30");
  });

  it("counts a line fixed from agent memory as an error the manual route would carry", () => {
    const m = manualRoute(s, 2)!; // VIDEO-DEMO-002, outdated GTIN resolved by the active memory rule
    expect(m.risks.some((r) => r.issueKey === null && r.amount === "50.00")).toBe(true);
  });

  it("totals delivered orders for the summary tiles", () => {
    const t = manualRouteTotals(s);
    expect(t.fieldsNotRetyped).toBeGreaterThan(0);
    expect(Number(t.exposureAvoided)).toBeGreaterThan(54);
  });

  it("lets only an administrator change the assumptions, and recomputes with them", () => {
    expect(() => setManualRouteAssumptions(s, DEFAULT_ASSUMPTIONS, REVIEWER)).toThrow(/administrator/);
    expect(() => setManualRouteAssumptions(s, { ...DEFAULT_ASSUMPTIONS, keyingErrorPercent: "150" }, ADMIN)).toThrow(/exceed 100/);
    expect(() => setManualRouteAssumptions(s, { ...DEFAULT_ASSUMPTIONS, hourlyRate: "1e3" }, ADMIN)).toThrow(/plain number/);
    const t = setManualRouteAssumptions(s, { ...DEFAULT_ASSUMPTIONS, asnMismatchFee: "200.00" }, ADMIN);
    expect(manualRoute(t, 1)!.chargebackExposure).toBe("204.38");
    expect(t.audit.at(-1)).toMatchObject({ event: "demo_setting_changed", detail: { key: "manual_route_assumptions" } });
  });
});
