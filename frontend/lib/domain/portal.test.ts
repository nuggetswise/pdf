// Supplier portal (D45, D75): the order confirmation, ASN and invoice workflow with their separate outbound deliveries.
// Document 1 is the Maple milk PO, delivered as SIM-ERP-100001: line 1 Whole Milk 120 x 18.00, line 2 Semi-Skimmed
// Milk 100 x 17.40, USD (hand-checked: 2,160.00 + 1,740.00). Document 2 is the cheese PO, delivered with Mozzarella short.
import { describe, expect, it } from "vitest";
import { forward, mapleRun, tickClock } from "./__fixtures__/maple";
import { cancelBackorder, deliverySummary, openQuantities, outboundList, portalForOrder, retryOutbound, setEdiFailureMode, submitAsn, submitInvoice } from "./portal";
import { RunState } from "./run-state";
import { Conflict, Forbidden, setDemoSetting } from "./workflow";

const REVIEWER = { actor: "reviewer:rita", role: "reviewer" };
const ADMIN = { actor: "administrator:alex", role: "administrator" };
const clock = { now: () => "2026-10-15T09:30:00.000Z" };
const base = () => mapleRun();
const ship = (a: string, b: string) => ({ lines: [{ lineIndex: 0, shippedQty: a }, { lineIndex: 1, shippedQty: b }],
  estimatedDelivery: "2026-10-20" });

describe("order confirmation", () => {
  it("is generated once per delivered order as its own delivery, and the run stays valid", () => {
    const s = base();
    const ordrsp = s.portal!.outbound.filter((m) => m.kind === "ORDRSP");
    // The cheese order waits for the supplier's stock decision, so only the milk order has been confirmed.
    expect(ordrsp.map((m) => m.sourceId)).toStrictEqual(["SIM-ERP-100001"]);
    expect(ordrsp.every((m) => m.status === "delivered" && m.channel === "retailer_edi_outbox")).toBe(true);
    expect(() => RunState.parse(s)).not.toThrow();
  });
});

describe("ASN", () => {
  it("a short shipment creates the 856 and an ERP shipment, each delivered on its own", () => {
    const s = submitAsn(base(), 1, ship("100", "100"), REVIEWER, clock);
    const p = portalForOrder(s, 1);
    expect(p.asn?.asnNumber).toBe("ASN-00001");
    expect(p.asn?.lines.map((l) => [l.orderedQty, l.shippedQty])).toStrictEqual([["120", "100"], ["100", "100"]]);
    expect(p.asnMessages.map((m) => [m.kind, m.status, m.idempotencyKey])).toStrictEqual([
      ["ERP_SHIPMENT", "delivered", "ERP-SHIPMENT:ASN-00001"], ["DESADV", "delivered", "DESADV:ASN-00001"]]);
    expect(p.asnMessages[1].format).toBe("x12");
    expect(p.asnMessages[1].body).toMatch(/^ST\*856\*0001~$/m);
    expect(p.asnMessages[1].body).toMatch(/^SN1\*\*100\*/m);
    expect(p.asnMessages[1].compliance).toMatchObject({ profile: "x12_retail", findings: [] });
    expect(s.portal!.received.map((r) => r.receiverRef)).toContain("SIM-SHP-100001");
    expect(() => RunState.parse(s)).not.toThrow();
  });

  it("blocks shipping more than ordered unless an override reason is given", () => {
    expect(() => submitAsn(base(), 1, ship("121", "100"), REVIEWER, clock)).toThrow(/more than the 120 ordered/);
    const ok = submitAsn(base(), 1, { lines: [{ lineIndex: 0, shippedQty: "121", overrideReason: "Customer agreed by phone (fictional)" },
      { lineIndex: 1, shippedQty: "100" }], estimatedDelivery: "2026-10-20" }, REVIEWER, clock);
    expect(portalForOrder(ok, 1).asn?.lines[0].overrideReason).toBe("Customer agreed by phone (fictional)");
  });

  it("refuses bad input, a second ASN, an undelivered order and the viewer role", () => {
    expect(() => submitAsn(base(), 1, ship("4.5x", "100"), REVIEWER, clock)).toThrow(Conflict);
    expect(() => submitAsn(base(), 1, ship("-1", "100"), REVIEWER, clock)).toThrow(Conflict);
    expect(() => submitAsn(base(), 1, ship("0", "0"), REVIEWER, clock)).toThrow(/Nothing is shipped/);
    expect(() => submitAsn(base(), 1, { lines: [{ lineIndex: 0, shippedQty: "1" }] }, REVIEWER, clock)).toThrow(/every order line/);
    // A third document, held for review, has not reached the ERP.
    const held = forward(base(), "moq", tickClock(Date.parse("2026-10-16T00:00:00.000Z")));
    expect(() => submitAsn(held.state, held.docId, { lines: [{ lineIndex: 0, shippedQty: "1" }] }, REVIEWER, clock)).toThrow(/delivered to the ERP/);
    expect(() => submitAsn(base(), 1, ship("100", "100"), { actor: "viewer:viewer", role: "viewer" }, clock)).toThrow(Forbidden);
    const once = submitAsn(base(), 1, ship("100", "100"), REVIEWER, clock);
    // D52: a second ASN may only ship what is still open (20 of line 1), and nothing once all has shipped.
    expect(() => submitAsn(once, 1, ship("100", "100"), REVIEWER, clock)).toThrow(/line 1: shipped 100 is more than the 20 still open/i);
    const all = submitAsn(base(), 1, ship("120", "100"), REVIEWER, clock);
    expect(() => submitAsn(all, 1, ship("1", "0"), REVIEWER, clock)).toThrow(/Nothing is left to ship/);
  });

  it("shows mixed states honestly and a retry delivers without duplicating", () => {
    let s = setEdiFailureMode(base(), "hold_next", ADMIN, clock);
    s = submitAsn(s, 1, ship("100", "100"), REVIEWER, clock);
    let msgs = portalForOrder(s, 1).asnMessages;
    expect(deliverySummary(msgs)).toBe("ERP synced, EDI to retailer pending");
    s = retryOutbound(s, msgs[1].id, REVIEWER, clock);
    msgs = portalForOrder(s, 1).asnMessages;
    expect(deliverySummary(msgs)).toBe("ERP synced, EDI to retailer delivered");
    expect(s.portal!.received.filter((r) => r.kind === "DESADV")).toHaveLength(1);
    expect(() => retryOutbound(s, msgs[1].id, REVIEWER, clock)).toThrow(/Already delivered/);
  });

  it("an ERP timeout is reconciled on retry, not sent twice", () => {
    let s = setDemoSetting(base(), "erp_failure_mode", "timeout_next", ADMIN, clock);
    s = submitAsn(s, 1, ship("100", "100"), REVIEWER, clock);
    const erp = portalForOrder(s, 1).asnMessages[0];
    expect(erp.status).toBe("pending");
    expect(deliverySummary(portalForOrder(s, 1).asnMessages)).toBe("ERP pending, EDI to retailer delivered");
    s = retryOutbound(s, erp.id, REVIEWER, clock);
    const after = portalForOrder(s, 1).asnMessages[0];
    expect(after.status).toBe("delivered");
    expect(after.attempts.at(-1)?.outcome).toBe("reconciled");
    expect(s.portal!.received.filter((r) => r.kind === "ERP_SHIPMENT")).toHaveLength(1);
  });

  it("an EDI failure is marked failed and can be retried", () => {
    let s = setEdiFailureMode(base(), "fail_next", ADMIN, clock);
    s = submitAsn(s, 1, ship("100", "100"), REVIEWER, clock);
    expect(deliverySummary(portalForOrder(s, 1).asnMessages)).toBe("ERP synced, EDI to retailer failed");
    s = retryOutbound(s, portalForOrder(s, 1).asnMessages[1].id, REVIEWER, clock);
    expect(portalForOrder(s, 1).asnMessages[1].status).toBe("delivered");
  });
});

describe("invoice", () => {
  const withAsn = () => submitAsn(base(), 1, ship("100", "100"), REVIEWER, clock);
  const asnId = (s: RunState) => portalForOrder(s, 1).asn!.id;
  const both = (a: string, b: string) => ({ lines: [{ lineIndex: 0, quantity: a }, { lineIndex: 1, quantity: b }] });

  it("uses the ASN quantity, the order price and exact decimal totals", () => {
    const s0 = withAsn();
    const s = submitInvoice(s0, asnId(s0), both("100", "100"), REVIEWER, clock);
    const { invoice, invoiceMessages } = portalForOrder(s, 1);
    // 100 x 18.00 = 1,800.00 and 100 x 17.40 = 1,740.00 (the 120 ordered are not invoiced).
    expect(invoice?.lines.map((l) => [l.quantity, l.unitPrice, l.lineAmount])).toStrictEqual([["100", "18.00", "1800.00"], ["100", "17.40", "1740.00"]]);
    // Fictional US supplier default: no sales tax (wholesale for resale).
    expect([invoice?.subtotal, invoice?.taxAmount, invoice?.total]).toStrictEqual(["3540.00", "0.00", "3540.00"]);
    expect(invoice?.currency).toBe("USD");
    const invoic = invoiceMessages.find((m) => m.kind === "INVOIC")!;
    expect(invoic.body).toMatch(/^ST\*810\*0001~$/m);
    expect(invoic.body).toMatch(/^IT1\*1\*100\*[A-Z]{2}\*18\.00\*\*/m);
    expect(invoic.body).not.toMatch(/^IT1\*1\*120\*/m);
    expect(invoic.body).toContain("TDS*354000~");
    expect(invoic.body).not.toContain("TXI*");
    expect(invoic.body).toContain("REF*PK*ASN-00001~");
    expect(invoiceMessages.map((m) => [m.kind, m.status])).toStrictEqual([["ERP_INVOICE", "delivered"], ["INVOIC", "delivered"]]);
    expect(() => RunState.parse(s)).not.toThrow();
  });

  it("blocks an invoice that does not match its ASN, and a second invoice", () => {
    const s0 = withAsn();
    const id = asnId(s0);
    expect(() => submitInvoice(s0, id, both("120", "100"), REVIEWER, clock))
      .toThrow(/does not match ASN-00001: line 1 must invoice the shipped quantity 100/);
    expect(() => submitInvoice(s0, id, { lines: [{ lineIndex: 0, quantity: "100" }] }, REVIEWER, clock)).toThrow(/does not match/);
    const s = submitInvoice(s0, id, both("100.0", "100"), REVIEWER, clock);
    expect(() => submitInvoice(s, id, both("100", "100"), REVIEWER, clock)).toThrow(/one invoice per ASN/);
    expect(outboundList(s)[0].kind).toBe("INVOIC");
  });
});

describe("partial shipments and payment terms (D52)", () => {
  it("ships the rest on a second ASN, each invoiced on its own with terms and a due date", () => {
    let s = submitAsn(base(), 1, ship("80", "100"), REVIEWER, clock);
    expect([...openQuantities(s, 1).values()].map((q) => q.toFixedPoint())).toEqual(["40", "0"]);
    s = submitAsn(s, 1, ship("40", "0"), REVIEWER, clock);
    const p = portalForOrder(s, 1);
    expect(p.shipments.map((x) => x.asn.asnNumber)).toEqual(["ASN-00001", "ASN-00002"]);
    expect(p.shipments[1].asn.lines.map((l) => [l.openQty, l.shippedQty])).toEqual([["40", "40"], ["0", "0"]]);
    expect([...openQuantities(s, 1).values()].every((q) => q.isZero())).toBe(true);
    s = submitInvoice(s, p.shipments[1].asn.id, { lines: [{ lineIndex: 0, quantity: "40" }] }, REVIEWER, clock);
    const inv = portalForOrder(s, 1).shipments[1].invoice!;
    // 40 x 18.00 = 720.00, due 30 days after the invoice date (2026-10-15).
    expect([inv.total, inv.dueDate]).toEqual(["720.00", "2026-11-14"]);
    expect(inv.terms).toEqual({ discountPercent: "2", discountDays: 10, netDays: 30 });
    const body = portalForOrder(s, 1).shipments[1].invoiceMessages.find((m) => m.kind === "INVOIC")!.body;
    expect(body).toContain("ITD*01*3*2**10**30~");
    expect(body).toContain("DTM*814*20261114~");
    expect(() => RunState.parse(s)).not.toThrow();
  });

  it("cancels what is left, tells the ERP once, and refuses another ASN", () => {
    let s = submitAsn(base(), 1, ship("80", "100"), REVIEWER, clock);
    expect(() => cancelBackorder(s, 1, "  ", REVIEWER, clock)).toThrow(/Give a reason/);
    s = cancelBackorder(s, 1, "Item discontinued (fictional)", REVIEWER, clock);
    expect(portalForOrder(s, 1).cancelled.map((c) => [c.lineIndex, c.quantity])).toEqual([[0, "40"]]);
    const change = s.portal!.outbound.filter((m) => m.kind === "ERP_ORDER_CHANGE");
    expect(change.map((m) => m.status)).toEqual(["delivered"]);
    expect(() => submitAsn(s, 1, ship("1", "0"), REVIEWER, clock)).toThrow(/Nothing is left to ship/);
    expect(() => cancelBackorder(s, 1, "again", REVIEWER, clock)).toThrow(/Nothing is left open/);
    expect(() => RunState.parse(s)).not.toThrow();
  });

  it("refuses cancelling before anything shipped", () => {
    expect(() => cancelBackorder(base(), 1, "no stock", REVIEWER, clock)).toThrow(/Ship something first/);
  });
});
