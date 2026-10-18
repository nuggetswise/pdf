// D61: stock check, ship date and the short-stock choice, on the example purchase order (fictional ERP stock).
import { describe, expect, it } from "vitest";
import { REVIEWER, tickClock } from "./__fixtures__/maple";
import { addWorkdays, isoDate, isoRange, subtractWorkdays } from "./dates";
import { exampleRun } from "./__fixtures__/example";
import { decideFulfilment, receiveStock, setStock, shipFromErp } from "./portal";
import { approve } from "./workflow";

async function delivered() {
  const { s, docId, clock } = await exampleRun();
  return { s: approve(s, docId, REVIEWER, clock), docId, clock };
}
const ADMIN = { actor: "administrator:alex", role: "administrator" };

describe("printed dates", () => {
  it("reads US layouts and fills a missing year from the PO date", () => {
    expect(isoDate("November 20, 2026")).toBe("2026-11-20");
    expect(isoDate("11/20/2026")).toBe("2026-11-20");
    expect(isoDate("Nov 10", "2026-10-15")).toBe("2026-11-10");
    expect(isoDate("Jan 5", "2026-12-01")).toBe("2027-01-05");
    expect(isoDate("20-Nov-2026")).toBe("2026-11-20");
    expect(isoDate("13/40/2026")).toBeNull();
    expect(isoDate("soon")).toBeNull();
    expect(isoRange("Nov 10 - Nov 17, 2026")).toEqual({ from: "2026-11-10", to: "2026-11-17" });
  });
  it("counts working days, skipping weekends", () => {
    expect(addWorkdays("2026-10-16", 2)).toBe("2026-10-20"); // Friday + 2 = Tuesday
    expect(subtractWorkdays("2026-11-20", 3)).toBe("2026-11-17");
  });
});

describe("the stock check on the example order", () => {
  it("finds the snack mix short and waits for a person before the retailer hears", async () => {
    const { s, docId } = await delivered();
    const o = s.orders.find((x) => x.documentId === docId)!;
    expect(o.deliveryState).toBe("erp_created");
    const f = o.fulfilment!;
    expect(f.status).toBe("needs_decision");
    expect(f.window).toMatchObject({ notBefore: "2026-11-10", noLaterThan: "2026-11-17", deliverBy: "2026-11-20", transitDays: 3, packDays: 2 });
    expect(f.shipBy).toBe("2026-11-17");
    const snack = f.lines.find((l) => l.sku === "NF-SNP-017")!;
    expect(snack).toMatchObject({ ordered: "85", availableNow: "60", short: "25", shortReadyOn: "2026-11-19", shortSource: "incoming" });
    expect(f.options.ship_complete.parts[0].shipOn).toBe("2026-11-23");
    expect(f.options.ship_complete.late).toBe(true);
    expect(f.recommended).toBe("ship_complete"); // the PO asks to ship complete
    expect(f.options.split!.parts.filter((p) => p.kind === "now").every((p) => p.shipOn === "2026-11-10")).toBe(true);
    expect((s.portal?.outbound ?? []).some((m) => m.kind === "ORDRSP")).toBe(false);
    expect(() => shipFromErp(s, docId, { carrierScac: "UPSN", trackingNumber: "1Z1" }, REVIEWER, tickClock())).toThrow(/Choose how to ship/);
  });

  it("a split ships what is there now and backorders the rest, line by line, to the retailer and the ERP", async () => {
    const { s: s0, docId, clock } = await delivered();
    const s = decideFulfilment(s0, docId, { choice: "split" }, REVIEWER, clock);
    const ack = s.portal!.outbound.find((m) => m.kind === "ORDRSP")!;
    expect(ack.body).toContain("DTM*068*20261110~");
    expect(ack.body).toContain("ACK*IA*60*CA*068*20261110~");
    expect(ack.body).toContain("ACK*IB*25*CA*068*20261123~");
    expect(ack.body).toContain("BAK*00*AC*PO-2026-104587*20261015~");
    expect(s.portal!.outbound.some((m) => m.idempotencyKey.startsWith("ERP-SCHEDULE:"))).toBe(true);
    expect(() => decideFulfilment(s, docId, { choice: "ship_complete" }, REVIEWER, clock)).toThrow(/already has the confirmation/);

    // Ships 60 now; ERP stock goes down; the rest follows when the incoming delivery is received.
    let t = shipFromErp(s, docId, { carrierScac: "UPSN", trackingNumber: "1Z1" }, REVIEWER, clock);
    const first = t.portal!.asns.at(-1)!;
    expect(first.lines.find((l) => l.sku === "NF-SNP-017")!.shippedQty).toBe("60");
    expect(t.erpStock!.find((x) => x.sku === "NF-SNP-017")!.onHand).toBe("0");
    t = receiveStock(t, "NF-SNP-017", "SUP-PO-77120", REVIEWER, clock);
    t = shipFromErp(t, docId, { carrierScac: "UPSN", trackingNumber: "1Z2" }, REVIEWER, clock);
    expect(t.portal!.asns.at(-1)!.lines.filter((l) => l.shippedQty !== "0").map((l) => [l.sku, l.shippedQty])).toEqual([["NF-SNP-017", "25"]]);
  });

  it("ship complete holds every line until the stock is in, with a later date if the supplier wants one", async () => {
    const { s: s0, docId, clock } = await delivered();
    expect(() => decideFulfilment(s0, docId, { choice: "ship_complete", shipOn: "2026-11-02" }, REVIEWER, clock)).toThrow(/earliest/);
    const s = decideFulfilment(s0, docId, { choice: "ship_complete", shipOn: "2026-11-24" }, REVIEWER, clock);
    expect(s.portal!.outbound.find((m) => m.kind === "ORDRSP")!.body).toContain("ACK*IA*85*CA*068*20261124~");
    expect(() => shipFromErp(s, docId, { carrierScac: "UPSN", trackingNumber: "1Z1" }, REVIEWER, clock)).toThrow(/ships complete/);
  });

  it("ship available cancels the short quantity, so the invoice follows what shipped", async () => {
    const { s: s0, docId, clock } = await delivered();
    const s = decideFulfilment(s0, docId, { choice: "ship_available" }, REVIEWER, clock);
    expect(s.portal!.outbound.find((m) => m.kind === "ORDRSP")!.body).toContain("ACK*IR*25*CA~");
    const t = shipFromErp(s, docId, { carrierScac: "UPSN", trackingNumber: "1Z1" }, REVIEWER, clock);
    expect(t.portal!.invoices.at(-1)!.lines.find((l) => l.sku === "NF-SNP-017")!.quantity).toBe("60");
  });

  it("with enough stock the order confirms on its own, and a second order cannot promise the same cases", async () => {
    const { s: s0, docId, clock } = await exampleRun();
    const stocked = setStock(s0, "NF-SNP-017", { onHand: "100", leadTimeDays: 21 }, ADMIN, clock);
    const s = approve(stocked, docId, REVIEWER, clock);
    const f = s.orders.find((x) => x.documentId === docId)!.fulfilment!;
    expect(f.status).toBe("confirmed");
    expect(s.portal!.outbound.find((m) => m.kind === "ORDRSP")!.body).toContain("DTM*068*20261110~");
    expect(() => setStock(s, "NF-SNP-017", { onHand: "-1", leadTimeDays: 1 }, ADMIN, clock)).toThrow();
    expect(() => setStock(s, "NF-SNP-017", { onHand: "1", leadTimeDays: 1 }, REVIEWER, clock)).toThrow();
  });
});
