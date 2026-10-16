// D51: GS1-128 labels, the ASN clock and carrier details on the 856.
import { describe, expect, it } from "vitest";
import { REVIEWER } from "./__fixtures__/demo";
import { replayGuidedDemo } from "./__fixtures__/replay";
import { asnTiming } from "./asn-timing";
import { gs1128Values, gs1128Widths, labelsFor, ssccBarcodeSvg } from "./labels";
import { portalForOrder, submitAsn } from "./portal";
import { checkX12 } from "./x12";

const clock = { now: () => "2026-10-15T09:30:00.000Z" };
const ship = { lines: [{ lineIndex: 0, shippedQty: "4" }, { lineIndex: 1, shippedQty: "2" }, { lineIndex: 2, shippedQty: "1" }],
  estimatedDelivery: "2026-10-20", packing: { cartonsPerPallet: 2 } };

describe("GS1-128 barcodes", () => {
  it("encodes (00) + SSCC as Code 128 set C with FNC1, matching ReportLab's encoder", () => {
    // GS1's published SSCC example. Expected values from reportlab Code128("\xf1" + "00106141411234567897").
    expect(gs1128Values("00106141411234567897")).toEqual([105, 102, 0, 10, 61, 41, 41, 12, 34, 56, 78, 97, 34, 106]);
  });
  it("every symbol is 11 modules and the stop 13", () => {
    const w = gs1128Widths("00106141411234567897");
    expect(w.reduce((a, b) => a + b, 0)).toBe(13 * 11 + 13);
  });
  it("refuses an SSCC with a wrong check digit", () => {
    expect(() => ssccBarcodeSvg("106141411234567890")).toThrow(/Not a valid SSCC/);
  });
});

describe("labels for an ASN", () => {
  it("one label per pallet and carton, carrying its SSCC and contents", () => {
    const s = submitAsn(replayGuidedDemo(), 1, ship, REVIEWER, clock);
    const asn = portalForOrder(s, 1).asn!;
    const labels = labelsFor(s, asn);
    expect(labels.map((l) => l.kind)).toEqual(["pallet", "carton", "carton", "pallet", "carton"]);
    expect(labels[1].contents[0]).toMatchObject({ sku: "DEMO-SKU-A", gtin: "614141000012", quantity: "4" });
    expect(new Set(labels.map((l) => l.sscc)).size).toBe(5);
  });
});

describe("carrier details", () => {
  it("go on the 856 as TD5 and REF and pass the X12 checks", () => {
    const s = submitAsn(replayGuidedDemo(), 1, { ...ship, carrierScac: "demo", bolNumber: "BOL-77", trackingNumber: "PRO 123" },
      REVIEWER, clock);
    const p = portalForOrder(s, 1);
    expect(p.asn).toMatchObject({ carrierScac: "DEMO", bolNumber: "BOL-77", trackingNumber: "PRO 123" });
    const body = p.asnMessages.find((m) => m.kind === "DESADV")!.body;
    expect(body).toContain("TD5**2*DEMO~");
    expect(body).toContain("REF*BM*BOL-77~");
    expect(body).toContain("REF*CN*PRO 123~");
    expect(checkX12("DESADV", body).findings).toEqual([]);
  });
  it("refuses a bad SCAC or a reference with separators", () => {
    expect(() => submitAsn(replayGuidedDemo(), 1, { ...ship, carrierScac: "U1" }, REVIEWER, clock)).toThrow(/2 to 4 letters/);
    expect(() => submitAsn(replayGuidedDemo(), 1, { ...ship, bolNumber: "A*B~" }, REVIEWER, clock)).toThrow(/letters, digits/);
  });
});

describe("ASN clock", () => {
  it("on time when sent on ship day and arriving by the PO date", () => {
    expect(asnTiming({ requestedDelivery: "2026-10-20", shipDate: "2026-10-15", estimatedDelivery: "2026-10-19", sentOn: "2026-10-15" }))
      .toEqual({ deliverBy: "2026-10-20", checks: [], onTime: true });
  });
  it("late when the goods left before the ASN went out", () => {
    const t = asnTiming({ requestedDelivery: "2026-10-20", shipDate: "2026-10-14", estimatedDelivery: "2026-10-19", sentOn: "2026-10-15" });
    expect(t.onTime).toBe(false);
    expect(t.checks.map((c) => c.key)).toEqual(["asn_after_ship"]);
  });
  it("warns when delivery lands after the PO date or is missing", () => {
    expect(asnTiming({ requestedDelivery: "2026-10-20", shipDate: "2026-10-15", estimatedDelivery: "2026-10-22", sentOn: "2026-10-15" })
      .checks.map((c) => c.key)).toEqual(["arrives_after_po_date"]);
    expect(asnTiming({ requestedDelivery: null, shipDate: "2026-10-15", estimatedDelivery: "", sentOn: "2026-10-15" })
      .checks.map((c) => c.key)).toEqual(["no_delivery_date"]);
  });
});
