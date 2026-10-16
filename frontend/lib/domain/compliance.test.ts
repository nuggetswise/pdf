// D47 retailer compliance: GS1 keys, the rule checks, packing with SSCCs, invoice tax and allowances, the
// three-way match, and that a message the retailer would reject is never sent.
// All parties and items are FICTIONAL (GS1 demonstration prefix 952; "Birchwood Demo Market" is invented).
import { describe, expect, it } from "vitest";
import { ADMIN, REVIEWER } from "./__fixtures__/demo";
import { ASN, BUYER, custId, sessionOrder, setUp } from "./__fixtures__/retailer";
import { replayGuidedDemo } from "./__fixtures__/replay";
import { blocking, checkMessage, parseInterchange, RULES, SOURCES } from "./compliance";
import { fictionalGln, gln, isGln, isGtin, isSscc, sscc } from "./gs1";
import { partnerFor, saveTradingPartner } from "./partners";
import {
  draftAsn, draftInvoice, invoiceTotals, packShipment, portalForOrder, retryOutbound, submitAsn, submitInvoice,
} from "./portal";
import { Conflict } from "./workflow";

const clock = { now: () => "2026-10-15T09:30:00.000Z" };
describe("GS1 keys", () => {
  it("computes the GS1 check digit for GLN, GTIN and SSCC", () => {
    expect(gln("629104150021")).toBe("6291041500213"); // GS1's published GLN example
    expect(isGtin("4006381333931")).toBe(true); // a well-known retail EAN-13
    expect(isGtin("4006381333932")).toBe(false);
    expect(sscc("0614141", 123456789, "1")).toBe("106141411234567897"); // GS1's published SSCC example
    expect(isSscc(sscc("9520000", 42))).toBe(true);
    expect(isGln(fictionalGln("buyer", 1))).toBe(true);
    expect(isGtin("614141000012")).toBe(true); // demo item GTIN-12 on GS1 example prefix 0614141
  });

  it("cites a source for every sourced rule and every source is used", () => {
    for (const r of RULES) {
      if (r.basis === "sourced") expect(r.sources.length).toBeGreaterThan(0);
      for (const id of r.sources) expect(SOURCES[id].url).toMatch(/^https:\/\//);
    }
    const used = new Set(RULES.flatMap((r) => r.sources));
    expect(Object.keys(SOURCES).filter((k) => !used.has(k as keyof typeof SOURCES) && k !== "gs1_prefixes")).toEqual([]);
  });
});

describe("fictional demo partner", () => {
  it("passes every rule, including valid item GTINs", () => {
    const s = submitAsn(replayGuidedDemo(), 1, { lines: [{ lineIndex: 0, shippedQty: "4" }, { lineIndex: 1, shippedQty: "2" },
      { lineIndex: 2, shippedQty: "1" }], estimatedDelivery: "2026-10-20" }, REVIEWER, clock);
    const desadv = portalForOrder(s, 1).asnMessages.find((m) => m.kind === "DESADV")!;
    expect(desadv.compliance!.findings.map((f) => [f.ruleId, f.severity])).toEqual([]);
    expect(partnerFor(s, "DEMO-CUST-01")).toMatchObject({ profile: "fictional_demo", isDefault: true, fictional: true });
  });

  it("blocks an ASN with no estimated delivery date and says why", () => {
    const s = replayGuidedDemo();
    const input = { lines: [{ lineIndex: 0, shippedQty: "4" }, { lineIndex: 1, shippedQty: "2" }, { lineIndex: 2, shippedQty: "1" }],
      estimatedDelivery: "" };
    expect(() => submitAsn(s, 1, input, REVIEWER, clock)).toThrow(/would reject this DESADV.*Estimated delivery date \(DTM\+17\) is missing/);
    expect(portalForOrder(s, 1).asn).toBeNull();
  });
});

describe("a real retailer (customer added from its PO)", () => {
  it("holds the order confirmation until the GLNs are set up, then sends it on retry", () => {
    const { s, docId } = sessionOrder();
    const conf = portalForOrder(s, docId).confirmation!;
    expect(conf.status).toBe("pending");
    expect(conf.attempts.at(-1)?.outcome).toBe("held");
    expect(conf.attempts.at(-1)?.detail).toMatch(/Buyer has no valid GLN/);
    expect(s.portal!.received).toHaveLength(0);
    const r = retryOutbound(setUp(s, docId), conf.id, REVIEWER, clock);
    const after = portalForOrder(r, docId).confirmation!;
    expect(after.status).toBe("delivered");
    expect(after.body).toContain(`NAD+BY+${BUYER}::9'`);
    expect(blocking(checkMessage("ORDRSP", after.body, "eancom2002"))).toEqual([]);
  });

  it("refuses the ASN until GLNs exist, with the reason, and records nothing", () => {
    const { s, docId } = sessionOrder();
    expect(() => submitAsn(s, docId, ASN, REVIEWER, clock)).toThrow(/Buyer has no valid GLN/);
    const ok = submitAsn(setUp(s, docId), docId, ASN, REVIEWER, clock);
    const desadv = portalForOrder(ok, docId).asnMessages.find((m) => m.kind === "DESADV")!;
    expect(desadv.compliance).toMatchObject({ profile: "eancom2002", findings: [] });
    expect(desadv.compliance!.rulesPassed).toBe(desadv.compliance!.rulesChecked);
  });

  it("refuses a GLN with a wrong check digit when it is entered", () => {
    const { s, docId } = sessionOrder();
    expect(() => saveTradingPartner(s, { customerId: custId(s, docId), profile: "eancom2002", buyerGln: "9520010007770",
      shipToGlns: [] }, REVIEWER, clock)).toThrow(/not a valid GLN/);
    expect(() => saveTradingPartner(s, { customerId: custId(s, docId), profile: "fictional_demo", shipToGlns: [] },
      REVIEWER, clock)).toThrow(/only for the fictional demo customers/);
  });

  it("packs cartons onto pallets with unique SSCCs, continuing the serial across ASNs", () => {
    const { s: s0, docId } = sessionOrder();
    const s = setUp(s0, docId);
    const r = submitAsn(s, docId, { ...ASN, packing: { cartonsPerPallet: 2,
      unitsPerCarton: [{ lineIndex: 0, units: "5" }, { lineIndex: 1, units: "5" }] } }, REVIEWER, clock);
    const asn = portalForOrder(r, docId).asn!;
    // 12 = 5 + 5 + 2, and 5 = 5: four cartons, two per pallet.
    expect(asn.pallets!.map((p) => p.cartons.map((c) => c.contents.map((x) => `${x.lineIndex}:${x.quantity}`).join()))).toEqual([
      ["0:5", "0:5"], ["0:2", "1:5"]]);
    const all = asn.pallets!.flatMap((p) => [p.sscc, ...p.cartons.map((c) => c.sscc)]);
    expect(new Set(all).size).toBe(6);
    expect(all.every(isSscc)).toBe(true);
    expect(r.portal!.ssccSerial).toBe(6);
    const body = portalForOrder(r, docId).asnMessages.find((m) => m.kind === "DESADV")!.body;
    expect(body.match(/^CPS\+/gm)).toHaveLength(7); // consignment + 2 pallets + 4 cartons
    expect(body).toContain("CNT+2:4'");
    // The next packing starts after the last serial used.
    expect(packShipment([{ lineIndex: 0, sourceLineId: "1", shippedQty: "1" }], undefined, "9520000", 6).pallets[0].sscc)
      .toBe(sscc("9520000", 7));
  });

  it("MediaMarktSaturn profile: an invoice without VAT numbers or an EDI agreement reference is refused", () => {
    const { s: s0, docId } = sessionOrder();
    let s = setUp(s0, docId, "mediamarktsaturn");
    s = submitAsn(s, docId, ASN, REVIEWER, clock);
    const asnId = portalForOrder(s, docId).asn!.id;
    const inv = { lines: [{ lineIndex: 0, quantity: "12" }, { lineIndex: 1, quantity: "5" }] };
    expect(() => submitInvoice(s, asnId, inv, REVIEWER, clock)).toThrow(/Buyer VAT registration number \(RFF\+VA\) is missing/);
    expect(() => submitInvoice(s, asnId, inv, REVIEWER, clock)).toThrow(/EDI agreement reference \(RFF\+CT\)/);
    s = setUp(s, docId, "mediamarktsaturn", { buyerVatId: "DE999999999", contractRef: "EDI-AGR-DEMO-1" });
    const ok = submitInvoice(s, asnId, inv, REVIEWER, clock);
    const invoic = portalForOrder(ok, docId).invoiceMessages.find((m) => m.kind === "INVOIC")!;
    expect(invoic.compliance!.findings).toEqual([]);
    expect(invoic.body).toContain("RFF+CT:EDI-AGR-DEMO-1'");
    expect(invoic.body).toContain(`NAD+BY+${BUYER}::9'\nRFF+VA:DE999999999'`);
  });
});

describe("invoice tax, allowances and three-way match", () => {
  const prepared = () => {
    const { s: s0, docId } = sessionOrder();
    const s = submitAsn(setUp(s0, docId), docId, { ...ASN, lines: [{ lineIndex: 0, shippedQty: "10" }, { lineIndex: 1, shippedQty: "5" }] },
      REVIEWER, clock);
    return { s, docId, asnId: portalForOrder(s, docId).asn!.id };
  };

  it("two tax rates, a 2% discount and a freight charge reconcile to the cent", () => {
    const { s, docId, asnId } = prepared();
    const r = submitInvoice(s, asnId, { lines: [{ lineIndex: 0, quantity: "10", taxRate: "19" }, { lineIndex: 1, quantity: "5", taxRate: "7" }],
      allowances: [{ kind: "allowance", code: "DI", percent: "2", taxRate: "19" },
        { kind: "charge", code: "FC", amount: "15.00", taxRate: "19" }] }, REVIEWER, clock);
    const inv = portalForOrder(r, docId).invoice!;
    // Lines: 10 x 12.50 = 125.00 at 19%, 5 x 9.80 = 49.00 at 7%. Discount 2% of 125.00 = 2.50; freight 15.00.
    // 19%: 125.00 - 2.50 + 15.00 = 137.50, tax 26.125 -> 26.13. 7%: 49.00, tax 3.43. Total 186.50 + 29.56 = 216.06.
    expect(inv.taxByRate).toEqual([{ rate: "7", taxable: "49.00", tax: "3.43" }, { rate: "19", taxable: "137.50", tax: "26.13" }]);
    expect([inv.subtotal, inv.taxableAmount, inv.taxAmount, inv.total]).toEqual(["174.00", "186.50", "29.56", "216.06"]);
    const body = portalForOrder(r, docId).invoiceMessages.find((m) => m.kind === "INVOIC")!.body;
    expect(body).toContain("ALC+A+++1+DI'\nPCD+3:2'\nMOA+204:2.50'\nTAX+7+VAT+++:::19+S'");
    expect(body).toContain("ALC+C+++1+FC'\nMOA+23:15.00'");
    expect(body).toContain("MOA+77:216.06'\nMOA+79:174.00'\nMOA+125:186.50'\nMOA+176:29.56'");
  });

  it("the totals rule catches a message whose numbers do not add up", () => {
    const { s, asnId } = prepared();
    const d = draftInvoice(s, asnId, { lines: [{ lineIndex: 0, quantity: "10" }, { lineIndex: 1, quantity: "5" }] }, "reviewer:rita", clock.now());
    expect(blocking(d.compliance)).toEqual([]);
    const tampered = d.message.text.replace(/MOA\+77:[\d.]+'/, "MOA+77:999.99'");
    expect(blocking(checkMessage("INVOIC", tampered, "eancom2002")).map((f) => f.text)).toEqual([
      "MOA+77 is 999.99; taxable amount plus tax is 207.06."]);
    const badLine = d.message.text.replace("MOA+203:125.00'", "MOA+203:126.00'");
    expect(blocking(checkMessage("INVOIC", badLine, "eancom2002")).map((f) => f.ruleId)).toEqual(
      expect.arrayContaining(["INVOICE-LINES", "INVOICE-TOTALS"]));
  });

  it("three-way match: a short shipment is explained, a quantity that is not the ASN's is refused", () => {
    const { s, asnId } = prepared();
    const d = draftInvoice(s, asnId, { lines: [{ lineIndex: 0, quantity: "10" }, { lineIndex: 1, quantity: "5" }] }, "reviewer:rita", clock.now());
    expect(d.match.map((m) => [m.sourceLineId, m.poQty, m.asnQty, m.invoiceQty, m.status])).toEqual([
      ["1", "12", "10", "10", "short_shipped"], ["2", "5", "5", "5", "matched"]]);
    expect(() => draftInvoice(s, asnId, { lines: [{ lineIndex: 0, quantity: "12" }, { lineIndex: 1, quantity: "5" }] },
      "reviewer:rita", clock.now())).toThrow(/must invoice the shipped quantity 10/);
  });

  it("refuses allowances that are bigger than the lines, unknown codes and missing tax rates", () => {
    const { s, asnId } = prepared();
    const lines = [{ lineIndex: 0, quantity: "10" }, { lineIndex: 1, quantity: "5" }];
    expect(() => draftInvoice(s, asnId, { lines, allowances: [{ kind: "allowance", code: "DI", amount: "500", taxRate: "19" }] },
      "r", clock.now())).toThrow(/larger than the lines/);
    expect(() => draftInvoice(s, asnId, { lines, allowances: [{ kind: "allowance", code: "XX", amount: "5", taxRate: "19" }] },
      "r", clock.now())).toThrow(/unknown reason code/);
    expect(() => draftInvoice(s, asnId, { lines, allowances: [{ kind: "allowance", code: "DI", amount: "5", taxRate: "7.5" }] },
      "r", clock.now())).toThrow(/one of the line rates/);
    expect(() => draftInvoice(s, asnId, { lines: [{ lineIndex: 0, quantity: "10", taxRate: "120" }, lines[1]] },
      "r", clock.now())).toThrow(Conflict);
    expect(invoiceTotals([], [])).toMatchObject({ invoiceAmount: "0.00", byRate: [] });
  });
});

describe("parser", () => {
  it("reads released characters back", () => {
    expect(parseInterchange("UNA:+.? 'RFF+ON:A?+B?:C?'D??'")).toEqual([{ tag: "RFF", els: [["ON", "A+B:C'D?"]] }]);
  });
  it("draftAsn does not change the run", () => {
    const s = replayGuidedDemo();
    const before = JSON.stringify(s);
    draftAsn(s, 1, { lines: [{ lineIndex: 0, shippedQty: "4" }, { lineIndex: 1, shippedQty: "2" }, { lineIndex: 2, shippedQty: "1" }] },
      ADMIN.actor, clock.now());
    expect(JSON.stringify(s)).toBe(before);
  });
});
