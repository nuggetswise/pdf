// D53: pilot measurement rows and their CSV.
import { describe, expect, it } from "vitest";
import { REVIEWER } from "./__fixtures__/demo";
import { replayGuidedDemo } from "./__fixtures__/replay";
import { PILOT_COLUMNS, pilotRows, toCsv } from "./pilot";
import { submitAsn } from "./portal";

const clock = { now: () => "2026-10-15T15:30:00.000Z" };

describe("pilot rows", () => {
  it("one row per order, with approval, timing and what the agent caught", () => {
    const rows = pilotRows(replayGuidedDemo());
    expect(rows.map((r) => r.po_number)).toEqual(["VIDEO-DEMO-001", "VIDEO-DEMO-002", "VIDEO-DEMO-003", "VIDEO-DEMO-004", "VIDEO-DEMO-005"]);
    expect(rows[0]).toMatchObject({ approved_by: "reviewer:rita", issues_caught: "3", decisions_by_person: "3", values_extracted: "33",
      manual_route_fields: "30", chargeback_exposure_avoided: "54.38", currency: "USD", asn_count: "0" });
    expect(rows[1]).toMatchObject({ approved_by: "policy (no human touch)", lines_fixed_by_memory: "1", decisions_by_person: "0" });
    expect(rows[2]).toMatchObject({ approved_by: "", in_erp_at: "", minutes_received_to_erp: "" });
  });

  it("measures minutes from ERP to the first ASN", () => {
    const s = submitAsn(replayGuidedDemo(), 1, { lines: [{ lineIndex: 0, shippedQty: "5" }, { lineIndex: 1, shippedQty: "2" },
      { lineIndex: 2, shippedQty: "1" }], estimatedDelivery: "2026-10-20" }, REVIEWER, clock);
    const r = pilotRows(s)[0];
    expect(r.asn_count).toBe("1");
    expect(r.first_asn_at).toBe("2026-10-15T15:30:00.000Z");
    expect(r.minutes_erp_to_first_asn).toBe("30.0");
  });
});

describe("CSV", () => {
  it("has a header, CRLF lines, quoting, and defuses spreadsheet formulas", () => {
    const row = Object.fromEntries(PILOT_COLUMNS.map((c) => [c, ""])) as Record<(typeof PILOT_COLUMNS)[number], string>;
    const csv = toCsv([{ ...row, po_number: "=HYPERLINK(\"x\")", customer_id: "A,B", minutes_received_to_erp: "-1.5" }]);
    const [head, line] = csv.split("\r\n");
    expect(head.split(",")).toEqual([...PILOT_COLUMNS]);
    expect(line.startsWith(`"'=HYPERLINK(""x"")","A,B",`)).toBe(true);
    expect(line).toContain(",-1.5,");
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});
