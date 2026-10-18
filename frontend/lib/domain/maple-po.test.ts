// D60, D75: the Maple purchase orders read end to end in the retailer layout with the labelled test adapter (not AI).
import { describe, expect, it } from "vitest";
import { forward, tickClock } from "./__fixtures__/maple";
import { dec } from "./money";
import { RunState, emptyRunState } from "./run-state";

describe("the Maple purchase orders", () => {
  it("read header, lines and terms from the retailer layout and match every product by supplier SKU", () => {
    const clock = tickClock();
    const { state: s } = forward(emptyRunState(clock.now()), "cheese", clock);
    const order = s.orders[0];
    const p = s.versions.find((v) => v.documentId === order.documentId && v.version === order.currentVersion)!.payload;
    expect(p.header.po_number.value).toBe("PO-2026-104633");
    expect(p.header.customer_name.value).toBe("Maple Retail Group Inc.");
    expect(p.header.total.value).toBe("6,815.00");
    expect(p.lines.map((l) => [l.supplier_sku?.value, l.quantity.value, l.unit.value])).toEqual([
      ["NF-CHS-001", "60", "Case"], ["NF-CHS-002", "85", "Case"]]);
    expect(p.terms?.ship_not_before?.value).toBe("Nov 10");
    expect(p.terms?.ship_no_later_than?.value).toBe("Nov 17, 2026");
    expect(p.terms?.payment_terms?.value).toBe("Net 30 Days");
    expect(p.terms?.freight_terms?.value).toBe("FOB Destination");
    expect(p.terms?.ship_complete?.value).toBe("Ship complete whenever possible.");
    expect(p.terms?.instructions).toHaveLength(4);
    expect([...Object.values(p.header), ...p.lines.flatMap((l) => Object.values(l))].filter((f) => f && f.value !== null && !f.evidence_verified)).toEqual([]);
    const v = order.validation!;
    expect(v.order.lines.map((l: { sku: string | null; unit: string | null }) => [l.sku, l.unit])).toEqual([
      ["NF-CHS-001", "CASE"], ["NF-CHS-002", "CASE"]]);
    expect(RunState.parse(s)).toBeTruthy();
    // The one blocking finding is the Cheddar price; nothing else in the PO stops it.
    expect(v.issues.filter((i: { blocking: boolean }) => i.blocking).map((i: { code: string }) => i.code)).toEqual(["price_mismatch"]);
  });

  it("the milk PO has no finding at all", () => {
    const clock = tickClock();
    const { state: s } = forward(emptyRunState(clock.now()), "milk", clock);
    expect(s.orders[0].validation!.issues).toEqual([]);
  });
});

describe("amounts printed with their currency", () => {
  it("reads USD 18.50, $18.50 and 2,220.00 USD as numbers", () => {
    expect(dec("USD 18.50")?.toString()).toBe("18.50");
    expect(dec("$18.50")?.toString()).toBe("18.50");
    expect(dec("2,220.00 USD")?.toString()).toBe("2220.00");
    expect(dec("EUR 5")).toBeNull();
  });
});
