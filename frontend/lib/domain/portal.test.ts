// Supplier portal (D45): EDIFACT builders and the ASN / invoice workflow with its separate outbound deliveries.
import { describe, expect, it } from "vitest";
import { replayGuidedDemo } from "./__fixtures__/replay";
import { type EdiParties, FICTIONAL_GLN, MESSAGE_VERSION, buildDesadv, buildInvoic, buildOrdrsp, esc } from "./edifact";
import { fictionalGln, gs1CheckDigit, sscc } from "./gs1";
import { deliverySummary, outboundList, portalForOrder, retryOutbound, setEdiFailureMode, submitAsn, submitInvoice } from "./portal";
import { RunState } from "./run-state";
import { Conflict, Forbidden, setDemoSetting } from "./workflow";

const REVIEWER = { actor: "reviewer:rita", role: "reviewer" };
const ADMIN = { actor: "administrator:alex", role: "administrator" };
const clock = { now: () => "2026-10-15T09:30:00.000Z" };
// Document 1 (VIDEO-DEMO-001) is delivered as SIM-ERP-100001: lines A 5 x 24.00, B 2 x 26.00, C 1 x 18.00, CAD.
const base = () => replayGuidedDemo();
const ship = (a: string, b: string, c: string) => ({ lines: [
  { lineIndex: 0, shippedQty: a }, { lineIndex: 1, shippedQty: b }, { lineIndex: 2, shippedQty: c }],
  estimatedDelivery: "2026-10-20" });
/** A fictional GTIN-13 on the GS1 demonstration prefix 952. */
const gtin = (n: number) => { const body = `9520000${String(n).padStart(5, "0")}`; return body + gs1CheckDigit(body); };
const GTIN_A = gtin(101);

/** Segments between UNH and UNT inclusive, counted on the raw text (split on unescaped '). */
function segmentsUnhToUnt(text: string): { count: number; unt: number } {
  // Split on the segment terminator, skipping any character released by "?". UNA is a fixed 9-character header.
  const segs: string[] = [];
  let cur = "";
  const body = text.replace(/\n/g, "").slice(9);
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "?") { cur += body[i] + body[++i]; continue; }
    if (body[i] === "'") { segs.push(cur); cur = ""; continue; }
    cur += body[i];
  }
  const from = segs.findIndex((x) => x.startsWith("UNH+"));
  const to = segs.findIndex((x) => x.startsWith("UNT+"));
  return { count: to - from + 1, unt: Number(segs[to].split("+")[1]) };
}

describe("EDIFACT builders", () => {
  const parties: EdiParties = { poNumber: "PO+1:'?", currency: "CAD",
    supplier: { gln: FICTIONAL_GLN.supplier }, buyer: { gln: FICTIONAL_GLN.retailer, name: "Shop 'A'" },
    deliveryParty: { gln: fictionalGln("ship_to", 1), printedId: "ST-1" } };
  const line = { sourceLineId: "A", gtin: GTIN_A, sku: "SKU-1", description: "Nuts + bolts: 'big'? yes\nnext",
    unit: "CASE", quantity: "4", orderedQty: "5", unitPrice: "24.00", lineAmount: "96.00", taxRate: "5" };
  const desadv = (lines = [line]) => buildDesadv({ ref: "ASN-00001", createdAt: clock.now(), despatchDate: "2026-10-15",
    estimatedDelivery: "2026-10-17", ...parties }, [{ sscc: sscc("9520000", 1), cartons: [{ sscc: sscc("9520000", 2), lines }] }]);
  const totals = { lineTotal: "96.00", taxableAmount: "96.00", taxAmount: "4.80", invoiceAmount: "100.80",
    byRate: [{ rate: "5", taxable: "96.00", tax: "4.80" }] };

  it("escapes the release characters ? ' + : in untrusted text", () => {
    expect(esc("a?b'c+d:e")).toBe("a??b?'c?+d?:e");
    expect(esc("line\nbreak")).toBe("line break");
    const m = desadv();
    expect(m.text).toContain("RFF+ON:PO?+1?:?'??'");
    expect(m.text).toContain("IMD+F++:::Nuts ?+ bolts?: ?'big?'?? yes next'");
    expect(m.text).not.toContain("\nnext");
  });

  it("does not leave a dangling release character when a long description is cut", () => {
    const m = desadv([{ ...line, description: `${"x".repeat(34)}'tail` }]);
    expect(m.text).toContain(`IMD+F++:::${"x".repeat(34)}?''`);
  });

  for (const [name, build] of [
    ["ORDRSP", () => buildOrdrsp({ ref: "ORDRSP-1", createdAt: clock.now(), erpOrderId: "SIM-ERP-1", orderDate: null, ...parties }, [line, line])],
    ["DESADV", () => desadv([line, line, line])],
    ["INVOIC", () => buildInvoic({ ref: "INV-00001", createdAt: clock.now(), asnRef: "ASN-00001", taxType: "GST", ...parties }, [line], [], totals)],
  ] as const) {
    it(`${name}: UNT carries the number of segments from UNH to UNT`, () => {
      const m = build();
      const { count, unt } = segmentsUnhToUnt(m.text);
      expect(unt).toBe(count);
      expect(m.text).toContain(`UNH+1+${MESSAGE_VERSION[name]}'`);
      expect(MESSAGE_VERSION[name]).toMatch(new RegExp(`^${name}:D:01B:UN:EAN0\\d\\d$`));
    });
    it(`${name}: deterministic for the same input`, () => expect(build().text).toBe(build().text));
  }

  it("DESADV nests pallet, carton and line with SSCCs", () => {
    const t = desadv().text;
    expect(t).toContain("CPS+1'\nPAC+1++201'\nCPS+2+1'\nPAC+1++201'\nPCI+33E'\nGIN+BJ+095200000000000011'");
    expect(t).toContain("CPS+3+2'\nPAC+1++CT'\nPCI+33E'\nGIN+BJ+095200000000000028'\nLIN+1++");
    expect(t).toContain("DTM+17:20261017:102'");
    expect(t).toContain("QTY+12:4'");
  });

  it("uses fictional GS1 demo-prefix GLNs with a valid check digit in the interchange header", () => {
    expect(FICTIONAL_GLN.supplier.startsWith("952")).toBe(true);
    expect(buildOrdrsp({ ref: "R", createdAt: clock.now(), erpOrderId: "E", orderDate: null, ...parties }, [line]).text)
      .toContain(`UNB+UNOC:3+${FICTIONAL_GLN.supplier}:14+${FICTIONAL_GLN.retailer}:14+261015:0930+R'`);
  });
});

describe("order confirmation", () => {
  it("is generated once per delivered order as its own delivery, and the run stays valid", () => {
    const s = base();
    const ordrsp = s.portal!.outbound.filter((m) => m.kind === "ORDRSP");
    expect(ordrsp.map((m) => m.sourceId)).toStrictEqual(["SIM-ERP-100001", "SIM-ERP-100002", "SIM-ERP-100003"]);
    expect(ordrsp.every((m) => m.status === "delivered" && m.channel === "retailer_edi_outbox")).toBe(true);
    expect(() => RunState.parse(s)).not.toThrow();
  });
});

describe("ASN", () => {
  it("a short shipment creates DESADV and an ERP shipment, each delivered on its own", () => {
    const s = submitAsn(base(), 1, ship("4", "2", "1"), REVIEWER, clock);
    const p = portalForOrder(s, 1);
    expect(p.asn?.asnNumber).toBe("ASN-00001");
    expect(p.asn?.lines.map((l) => [l.orderedQty, l.shippedQty])).toStrictEqual([["5", "4"], ["2", "2"], ["1", "1"]]);
    expect(p.asnMessages.map((m) => [m.kind, m.status, m.idempotencyKey])).toStrictEqual([
      ["ERP_SHIPMENT", "delivered", "ERP-SHIPMENT:ASN-00001"], ["DESADV", "delivered", "DESADV:ASN-00001"]]);
    expect(p.asnMessages[1].body).toContain("QTY+12:4'");
    expect(p.asnMessages[1].compliance).toMatchObject({ profile: "fictional_demo" });
    expect(p.asnMessages[1].compliance!.findings.every((f) => f.severity === "warn" && f.ruleId === "ITEM-GTIN")).toBe(true);
    expect(s.portal!.received.map((r) => r.receiverRef)).toContain("SIM-SHP-100001");
    expect(() => RunState.parse(s)).not.toThrow();
  });

  it("blocks shipping more than ordered unless an override reason is given", () => {
    expect(() => submitAsn(base(), 1, ship("6", "2", "1"), REVIEWER, clock)).toThrow(/more than the 5 ordered/);
    const ok = submitAsn(base(), 1, { lines: [{ lineIndex: 0, shippedQty: "6", overrideReason: "Customer agreed by phone (fictional)" },
      { lineIndex: 1, shippedQty: "2" }, { lineIndex: 2, shippedQty: "1" }], estimatedDelivery: "2026-10-20" }, REVIEWER, clock);
    expect(portalForOrder(ok, 1).asn?.lines[0].overrideReason).toBe("Customer agreed by phone (fictional)");
  });

  it("refuses bad input, a second ASN, an undelivered order and the viewer role", () => {
    expect(() => submitAsn(base(), 1, ship("4.5x", "2", "1"), REVIEWER, clock)).toThrow(Conflict);
    expect(() => submitAsn(base(), 1, ship("-1", "2", "1"), REVIEWER, clock)).toThrow(Conflict);
    expect(() => submitAsn(base(), 1, ship("0", "0", "0"), REVIEWER, clock)).toThrow(/Nothing is shipped/);
    expect(() => submitAsn(base(), 1, { lines: [{ lineIndex: 0, shippedQty: "1" }] }, REVIEWER, clock)).toThrow(/every order line/);
    expect(() => submitAsn(base(), 3, { lines: [{ lineIndex: 0, shippedQty: "1" }] }, REVIEWER, clock)).toThrow(/delivered to the ERP/);
    expect(() => submitAsn(base(), 1, ship("4", "2", "1"), { actor: "viewer:viewer", role: "viewer" }, clock)).toThrow(Forbidden);
    const once = submitAsn(base(), 1, ship("4", "2", "1"), REVIEWER, clock);
    expect(() => submitAsn(once, 1, ship("4", "2", "1"), REVIEWER, clock)).toThrow(/already has ASN-00001/);
  });

  it("shows mixed states honestly and a retry delivers without duplicating", () => {
    let s = setEdiFailureMode(base(), "hold_next", ADMIN, clock);
    s = submitAsn(s, 1, ship("4", "2", "1"), REVIEWER, clock);
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
    s = submitAsn(s, 1, ship("4", "2", "1"), REVIEWER, clock);
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
    s = submitAsn(s, 1, ship("4", "2", "1"), REVIEWER, clock);
    expect(deliverySummary(portalForOrder(s, 1).asnMessages)).toBe("ERP synced, EDI to retailer failed");
    s = retryOutbound(s, portalForOrder(s, 1).asnMessages[1].id, REVIEWER, clock);
    expect(portalForOrder(s, 1).asnMessages[1].status).toBe("delivered");
  });
});

describe("invoice", () => {
  const withAsn = () => submitAsn(base(), 1, ship("4", "2", "0"), REVIEWER, clock);
  const asnId = (s: RunState) => portalForOrder(s, 1).asn!.id;

  it("uses the ASN quantity, the order price and exact decimal totals", () => {
    const s0 = withAsn();
    const s = submitInvoice(s0, asnId(s0), { lines: [{ lineIndex: 0, quantity: "4" }, { lineIndex: 1, quantity: "2" }] }, REVIEWER, clock);
    const { invoice, invoiceMessages } = portalForOrder(s, 1);
    expect(invoice?.lines.map((l) => [l.quantity, l.unitPrice, l.lineAmount])).toStrictEqual([["4", "24.00", "96.00"], ["2", "26.00", "52.00"]]);
    // Fictional demo supplier default: GST 5%. 148.00 + 7.40 = 155.40.
    expect([invoice?.subtotal, invoice?.taxAmount, invoice?.total]).toStrictEqual(["148.00", "7.40", "155.40"]);
    expect(invoice?.currency).toBe("CAD");
    const invoic = invoiceMessages.find((m) => m.kind === "INVOIC")!;
    expect(invoic.body).toContain("QTY+47:4'");
    expect(invoic.body).not.toContain("QTY+47:5");
    expect(invoic.body).toContain("MOA+79:148.00'");
    expect(invoic.body).toContain("MOA+77:155.40'");
    expect(invoic.body).toContain("TAX+7+GST+++:::5+S'\nMOA+124:7.40'\nMOA+125:148.00'");
    expect(invoic.body).toContain("RFF+AAK:ASN-00001'");
    expect(invoiceMessages.map((m) => [m.kind, m.status])).toStrictEqual([["ERP_INVOICE", "delivered"], ["INVOIC", "delivered"]]);
    expect(() => RunState.parse(s)).not.toThrow();
  });

  it("blocks an invoice that does not match its ASN, and a second invoice", () => {
    const s0 = withAsn();
    const id = asnId(s0);
    expect(() => submitInvoice(s0, id, { lines: [{ lineIndex: 0, quantity: "5" }, { lineIndex: 1, quantity: "2" }] }, REVIEWER, clock))
      .toThrow(/does not match ASN-00001: line A must invoice the shipped quantity 4/);
    expect(() => submitInvoice(s0, id, { lines: [{ lineIndex: 0, quantity: "4" }, { lineIndex: 1, quantity: "2" },
      { lineIndex: 2, quantity: "1" }] }, REVIEWER, clock)).toThrow(/does not match/);
    const s = submitInvoice(s0, id, { lines: [{ lineIndex: 0, quantity: "4.0" }, { lineIndex: 1, quantity: "2" }] }, REVIEWER, clock);
    expect(() => submitInvoice(s, id, { lines: [{ lineIndex: 0, quantity: "4" }, { lineIndex: 1, quantity: "2" }] }, REVIEWER, clock))
      .toThrow(/one invoice per ASN/);
    expect(outboundList(s)[0].kind).toBe("INVOIC");
  });
});
