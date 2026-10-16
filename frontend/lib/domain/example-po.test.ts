// D60: the one bundled example purchase order, read end to end with the labelled test adapter (not AI).
import { describe, expect, it } from "vitest";
import { exampleRun } from "./__fixtures__/example";
import { RunState } from "./run-state";

describe("the example purchase order", () => {
  it("reads header, lines and terms from the retailer layout and matches every product by supplier SKU", async () => {
    const { s } = await exampleRun();
    const order = s.orders[0];
    const p = s.versions.find((v) => v.documentId === order.documentId && v.version === order.currentVersion)!.payload;
    expect(p.header.po_number.value).toBe("PO-2026-104587");
    expect(p.header.customer_name.value).toBe("Maple Retail Group Inc.");
    expect(p.header.total.value).toBe("9,476.25");
    expect(p.lines.map((l) => [l.supplier_sku?.value, l.quantity.value, l.unit.value])).toEqual([
      ["NF-CRK-001", "120", "Case"], ["NF-SNP-017", "85", "Case"], ["NF-BEV-042", "150", "Case"], ["NF-CER-010", "100", "Case"]]);
    expect(p.terms?.ship_not_before?.value).toBe("Nov 10");
    expect(p.terms?.ship_no_later_than?.value).toBe("Nov 17, 2026");
    expect(p.terms?.payment_terms?.value).toBe("Net 30 Days");
    expect(p.terms?.freight_terms?.value).toBe("FOB Destination");
    expect(p.terms?.ship_complete?.value).toBe("Ship complete whenever possible.");
    expect(p.terms?.instructions).toHaveLength(4);
    expect([...Object.values(p.header), ...p.lines.flatMap((l) => Object.values(l))].filter((f) => f && f.value !== null && !f.evidence_verified)).toEqual([]);
    const v = order.validation!;
    expect(v.order.lines.map((l: { sku: string | null; unit: string | null }) => [l.sku, l.unit])).toEqual([
      ["NF-CRK-001", "CASE"], ["NF-SNP-017", "CASE"], ["NF-BEV-042", "CASE"], ["NF-CER-010", "CASE"]]);
    expect(RunState.parse(s)).toBeTruthy();
    expect(v.issues.filter((i: { blocking: boolean }) => i.blocking)).toEqual([]);
  });
});

describe("amounts printed with their currency", () => {
  it("reads USD 18.50, $18.50 and 2,220.00 USD as numbers", async () => {
    const { dec } = await import("./money");
    expect(dec("USD 18.50")?.toString()).toBe("18.50");
    expect(dec("$18.50")?.toString()).toBe("18.50");
    expect(dec("2,220.00 USD")?.toString()).toBe("2220.00");
    expect(dec("EUR 5")).toBeNull();
  });
});
