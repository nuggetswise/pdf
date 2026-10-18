// D61: stock check, ship date and the short-stock choice, on the Maple cheese PO (fictional ERP stock).
import { describe, expect, it } from "vitest";
import { ADMIN as ADMIN_WHO, REVIEWER, forward, mapleRunWithClock, tickClock } from "./__fixtures__/maple";
import { addWorkdays, isoDate, isoRange, subtractWorkdays } from "./dates";
import { decideFulfilment, receiveStock, setStock, shipFromErp } from "./portal";
import { type RunState, emptyRunState } from "./run-state";
import { decide, resetTestData } from "./workflow";

/** The Maple run: milk delivered and confirmed, cheese decided on its price and delivered, Mozzarella short. */
function delivered() {
  const { s, clock } = mapleRunWithClock();
  return { s, docId: 2, clock };
}
const ADMIN = ADMIN_WHO;
/** The order confirmation for the cheese PO (the milk PO was confirmed earlier in the same run). */
const cheeseAck = (s: RunState) => s.portal?.outbound.find((m) => m.kind === "ORDRSP" && m.body.includes("PO-2026-104633"));

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

describe("the stock check on the cheese order", () => {
  it("finds the Mozzarella short and waits for a person before the retailer hears", () => {
    const { s, docId } = delivered();
    const o = s.orders.find((x) => x.documentId === docId)!;
    expect(o.deliveryState).toBe("erp_created");
    const f = o.fulfilment!;
    expect(f.status).toBe("needs_decision");
    expect(f.window).toMatchObject({ notBefore: "2026-11-10", noLaterThan: "2026-11-17", deliverBy: "2026-11-20", transitDays: 3, packDays: 2 });
    expect(f.shipBy).toBe("2026-11-17");
    const mozzarella = f.lines.find((l) => l.sku === "NF-CHS-002")!;
    expect(mozzarella).toMatchObject({ ordered: "85", availableNow: "60", short: "25", shortReadyOn: "2026-11-19", shortSource: "incoming" });
    expect(f.options.ship_complete.parts[0].shipOn).toBe("2026-11-23");
    expect(f.options.ship_complete.late).toBe(true);
    expect(f.recommended).toBe("ship_complete"); // the PO asks to ship complete
    expect(f.options.split!.parts.filter((p) => p.kind === "now").every((p) => p.shipOn === "2026-11-10")).toBe(true);
    expect(cheeseAck(s)).toBeUndefined();
    expect(() => shipFromErp(s, docId, { carrierScac: "UPSN", trackingNumber: "1Z1" }, REVIEWER, tickClock())).toThrow(/Choose how to ship/);
  });

  it("a split ships what is there now and backorders the rest, line by line, to the retailer and the ERP", () => {
    const { s: s0, docId, clock } = delivered();
    const s = decideFulfilment(s0, docId, { choice: "split" }, REVIEWER, clock);
    const ack = cheeseAck(s)!;
    expect(ack.body).toContain("DTM*068*20261110~");
    expect(ack.body).toContain("ACK*IA*60*CA*068*20261110~");
    expect(ack.body).toContain("ACK*IB*25*CA*068*20261123~");
    expect(ack.body).toContain("BAK*00*AC*PO-2026-104633*20261015~");
    expect(s.portal!.outbound.some((m) => m.idempotencyKey.startsWith("ERP-SCHEDULE:"))).toBe(true);
    expect(() => decideFulfilment(s, docId, { choice: "ship_complete" }, REVIEWER, clock)).toThrow(/already has the confirmation/);

    // Ships 60 now; ERP stock goes down; the rest follows when the incoming delivery is received.
    let t = shipFromErp(s, docId, { carrierScac: "UPSN", trackingNumber: "1Z1" }, REVIEWER, clock);
    const first = t.portal!.asns.at(-1)!;
    expect(first.lines.find((l) => l.sku === "NF-CHS-002")!.shippedQty).toBe("60");
    expect(t.erpStock!.find((x) => x.sku === "NF-CHS-002")!.onHand).toBe("0");
    t = receiveStock(t, "NF-CHS-002", "SUP-PO-77120", REVIEWER, clock);
    t = shipFromErp(t, docId, { carrierScac: "UPSN", trackingNumber: "1Z2" }, REVIEWER, clock);
    expect(t.portal!.asns.at(-1)!.lines.filter((l) => l.shippedQty !== "0").map((l) => [l.sku, l.shippedQty])).toEqual([["NF-CHS-002", "25"]]);
  });

  it("ship complete holds every line until the stock is in, with a later date if the supplier wants one", () => {
    const { s: s0, docId, clock } = delivered();
    expect(() => decideFulfilment(s0, docId, { choice: "ship_complete", shipOn: "2026-11-02" }, REVIEWER, clock)).toThrow(/earliest/);
    const s = decideFulfilment(s0, docId, { choice: "ship_complete", shipOn: "2026-11-24" }, REVIEWER, clock);
    expect(cheeseAck(s)!.body).toContain("ACK*IA*85*CA*068*20261124~");
    expect(() => shipFromErp(s, docId, { carrierScac: "UPSN", trackingNumber: "1Z1" }, REVIEWER, clock)).toThrow(/ships complete/);
  });

  it("ship available cancels the short quantity, so the invoice follows what shipped", () => {
    const { s: s0, docId, clock } = delivered();
    const s = decideFulfilment(s0, docId, { choice: "ship_available" }, REVIEWER, clock);
    expect(cheeseAck(s)!.body).toContain("ACK*IR*25*CA~");
    const t = shipFromErp(s, docId, { carrierScac: "UPSN", trackingNumber: "1Z1" }, REVIEWER, clock);
    expect(t.portal!.invoices.at(-1)!.lines.find((l) => l.sku === "NF-CHS-002")!.quantity).toBe("60");
  });

  it("with enough stock the order confirms on its own, and a second order cannot promise the same cases", () => {
    const clock = tickClock();
    let s = resetTestData(emptyRunState(clock.now()), ADMIN, clock);
    let docId: number;
    ({ state: s, docId } = forward(s, "cheese", clock));
    s = setStock(s, "NF-CHS-002", { onHand: "100", leadTimeDays: 21 }, ADMIN, clock);
    s = decide(s, docId, { issueKey: "price_mismatch:0", action: "accept_printed_price", reason: "Price confirmed (fictional)" }, REVIEWER, clock);
    const f = s.orders.find((x) => x.documentId === docId)!.fulfilment!;
    expect(f.status).toBe("confirmed");
    expect(cheeseAck(s)!.body).toContain("DTM*068*20261110~");
    expect(() => setStock(s, "NF-CHS-002", { onHand: "-1", leadTimeDays: 1 }, ADMIN, clock)).toThrow();
    expect(() => setStock(s, "NF-CHS-002", { onHand: "1", leadTimeDays: 1 }, REVIEWER, clock)).toThrow();
  });
});
