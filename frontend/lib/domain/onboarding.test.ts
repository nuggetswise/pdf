// D46 session onboarding: a reviewer adds the customer and products a real PO uses, for this session only.
// All data is FICTIONAL test data ("Birchwood Demo Market" is invented and not in the reference file).
import { describe, expect, it } from "vitest";
import { ADMIN, INTAKE_ACTOR, REVIEWER, VIEWER, extract, tickClock } from "./__fixtures__/demo";
import { RunState, emptyRunState } from "./run-state";
import {
  Conflict, Forbidden, addCustomer, addProduct, addShipTo, approve, assignCustomer, receive, resetDemo, setPolicy,
} from "./workflow";
import { applyAction } from "../server/run-action";

const PO = (po: string, lines: string[], totals: string[], opts: { customer?: string; itemCodes?: boolean;
  shipTo?: string } = {}) => `FICTIONAL TEST DATA - NOT A REAL CUSTOMER ORDER
PURCHASE ORDER
PO: ${po}
Customer: ${opts.customer ?? "Birchwood Demo Market"}
${opts.shipTo ? `Ship-to: ${opts.shipTo}\n` : ""}Supplier: Marlow Demo Foods
Currency: USD
Line | ${opts.itemCodes ? "Customer item" : "GTIN"} | Description | Quantity | Unit | Unit price | Amount
${lines.join("\n")}
Subtotal: ${totals[0]}
Tax amount: ${totals[1]}
Shipping amount: ${totals[2]}
Total: ${totals[3]}
`;
const FIRST = PO("BW-DEMO-5001", ["1 | FICT-GTIN-7001 | Demo maple cookies 300g | 40 | CASE | 12.50 | 500.00",
  "2 | FICT-GTIN-7002 | Demo apple chips 150g | 25 | CASE | 9.80 | 245.00"], ["745.00", "96.85", "20.00", "861.85"]);
const REPEAT = PO("BW-DEMO-5002", ["1 | FICT-GTIN-7001 | Demo maple cookies 300g | 10 | CASE | 12.50 | 125.00",
  "2 | FICT-GTIN-7002 | Demo apple chips 150g | 5 | CASE | 9.80 | 49.00"], ["174.00", "22.62", "0.00", "196.62"]);

let n = 0;
function upload(s: RunState, text: string, clock = tickClock()) {
  const sha = (++n).toString(16).padStart(64, "0");
  const r = receive(s, { messageId: null, sender: null, receivedAt: null, subjectMetadata: null,
    intakeMode: "demo_envelope_upload", rawSha256: null },
  [{ originalFilename: "po.pdf", sha256: sha, sizeBytes: text.length, pageCount: 1, pageText: [text] }], INTAKE_ACTOR, clock);
  return { state: extract(r.state, r.documentIds[0], clock), docId: r.documentIds[0] };
}
const order = (s: RunState, id: number) => s.orders.find((o) => o.documentId === id)!;
const open = (s: RunState, id: number) => order(s, id).validation.issues.filter((i) => i.status === "open");
const codes = (s: RunState, id: number) => open(s, id).map((i) => i.code).sort();

describe("session onboarding (D46)", () => {
  it("adds an unknown customer and its products, then the order clears and a repeat order is clean", () => {
    const clock = tickClock();
    let { state: s, docId } = upload(emptyRunState(clock.now()), FIRST, clock);
    expect(codes(s, docId)).toEqual(["unknown_customer", "unknown_item", "unknown_item"]);
    // Products are per customer, so the customer comes first.
    expect(() => addProduct(s, docId, "unknown_item:0", {}, REVIEWER, clock)).toThrow(Conflict);

    s = addCustomer(s, docId, {}, REVIEWER, clock);
    expect(codes(s, docId)).toEqual(["unknown_item", "unknown_item"]);
    expect(s.referenceOverlay!.customers[0]).toMatchObject({ customerId: "SESSION-CUST-01",
      name: "Birchwood Demo Market", currency: "USD", shipToIds: [], addedBy: "reviewer:rita", sourceDocumentId: docId });
    expect(order(s, docId).customerId).toBe("SESSION-CUST-01");

    s = addProduct(s, docId, "unknown_item:0", {}, REVIEWER, clock);
    s = addProduct(s, docId, "unknown_item:1", { moq: "5" }, REVIEWER, clock);
    expect(open(s, docId)).toEqual([]);
    const p = s.referenceOverlay!.products;
    expect(p.map((x) => [x.sku, x.gtin, x.unit, x.price, x.currency, x.moq])).toEqual([
      ["FICT-GTIN-7001", "FICT-GTIN-7001", "CASE", "12.50", "USD", "1"],
      ["FICT-GTIN-7002", "FICT-GTIN-7002", "CASE", "9.80", "USD", "5"]]);
    for (const x of p) expect(typeof x.price).toBe("string");
    expect(order(s, docId).validation.order.reference_version).toBe("REF-2026-10-v1 + session additions");
    expect(order(s, docId).reviewState).toBe("ready");
    expect(s.audit.filter((a) => a.event.startsWith("reference_")).map((a) => [a.event, a.actor])).toEqual([
      ["reference_customer_added", "reviewer:rita"], ["reference_product_added", "reviewer:rita"],
      ["reference_product_added", "reviewer:rita"]]);

    s = approve(s, docId, REVIEWER, clock);
    expect(order(s, docId).deliveryState).toBe("erp_created");
    expect(RunState.safeParse(s).success).toBe(true);

    const again = upload(s, REPEAT, clock);
    expect(order(again.state, again.docId).validation.issues).toEqual([]);
    expect(order(again.state, again.docId).customerId).toBe("SESSION-CUST-01");
    expect(order(again.state, again.docId).validation.order.lines.map((l) => l.sku))
      .toEqual(["FICT-GTIN-7001", "FICT-GTIN-7002"]);
  });

  it("checks the added prices and minimums on later orders", () => {
    const clock = tickClock();
    let { state: s, docId } = upload(emptyRunState(clock.now()), FIRST, clock);
    s = addCustomer(s, docId, {}, REVIEWER, clock);
    s = addProduct(s, docId, "unknown_item:0", { moq: "20" }, REVIEWER, clock);
    s = addProduct(s, docId, "unknown_item:1", {}, REVIEWER, clock);
    const later = upload(s, PO("BW-DEMO-5003", ["1 | FICT-GTIN-7001 | Demo maple cookies 300g | 10 | CASE | 13.00 | 130.00"],
      ["130.00", "0.00", "0.00", "130.00"]), clock);
    expect(codes(later.state, later.docId)).toEqual(["moq_violation", "price_mismatch"]);
  });

  it("matches item-code-only lines (like the owner's real PO) through a customer alias", () => {
    const clock = tickClock();
    const text = PO("BW-DEMO-6001", ["1 | NF-DEMO-001 | Demo crackers 250g | 120 | Case | 18.50 | 2220.00"],
      ["2220.00", "0.00", "0.00", "2220.00"], { itemCodes: true });
    let { state: s, docId } = upload(emptyRunState(clock.now()), text, clock);
    expect(codes(s, docId)).toEqual(["unknown_customer", "unknown_item"]);
    s = addCustomer(s, docId, { name: "Birchwood Market (renamed)" }, REVIEWER, clock);
    s = addProduct(s, docId, "unknown_item:0", { sku: "BW-CRACKERS" }, REVIEWER, clock);
    expect(open(s, docId)).toEqual([]);
    expect(s.referenceOverlay!.products[0]).toMatchObject({ sku: "BW-CRACKERS", gtin: null, customerItemCode: "NF-DEMO-001",
      unit: "Case", price: "18.50" });
    // The edited name keeps matching what the customer prints.
    expect(s.referenceOverlay!.customerAliases[0]).toMatchObject({ printed: "Birchwood Demo Market", customerId: "SESSION-CUST-01" });
    const again = upload(s, text.replace("BW-DEMO-6001", "BW-DEMO-6002"), clock);
    expect(order(again.state, again.docId).validation.issues).toEqual([]);
  });

  it("assigns a printed name to an existing customer, and a printed ship-to can be added", () => {
    const clock = tickClock();
    const text = PO("NF-ALT-1", ["A | 614141000012 | Demo granola case | 10 | CASE | 24.00 | 240.00"],
      ["240.00", "0.00", "0.00", "240.00"], { customer: "Northfield Retail (head office)", shipTo: "NF-STORE-77" });
    let { state: s, docId } = upload(emptyRunState(clock.now()), text, clock);
    expect(codes(s, docId)).toEqual(["unknown_customer"]);
    expect(() => assignCustomer(s, docId, "NOPE", REVIEWER, clock)).toThrow(Conflict);
    s = assignCustomer(s, docId, "DEMO-CUST-01", REVIEWER, clock);
    expect(codes(s, docId)).toEqual(["unknown_ship_to"]);
    s = addShipTo(s, docId, REVIEWER, clock);
    expect(open(s, docId)).toEqual([]);
    expect(order(s, docId).customerId).toBe("DEMO-CUST-01");
  });

  it("is never automatic, needs a reviewer, refuses clashes, and reset removes the additions", () => {
    const clock = tickClock();
    let { state: s, docId } = upload(emptyRunState(clock.now()), FIRST, clock);
    expect(() => addCustomer(s, docId, {}, VIEWER, clock)).toThrow(Forbidden);
    expect(s.referenceOverlay).toBeUndefined();
    s = addCustomer(s, docId, {}, REVIEWER, clock);
    expect(() => addCustomer(s, docId, {}, REVIEWER, clock)).toThrow(Conflict); // issue already resolved
    expect(() => addProduct(s, docId, "unknown_item:0", { sku: "DEMO-SKU-A" }, REVIEWER, clock)).toThrow(/already in the catalogue/);
    expect(() => addProduct(s, docId, "unknown_item:0", { moq: "0" }, REVIEWER, clock)).toThrow(Conflict);
    expect(resetDemo(s, ADMIN, clock).referenceOverlay).toBeUndefined();
  });

  it("waits for an explicit approval in Exception-only mode after onboarding; the repeat order then auto-delivers", () => {
    const clock = tickClock();
    let s = setPolicy(emptyRunState(clock.now()), "exception_only", ADMIN, clock);
    let docId: number;
    ({ state: s, docId } = upload(s, FIRST, clock));
    s = addCustomer(s, docId, {}, REVIEWER, clock);
    s = addProduct(s, docId, "unknown_item:0", {}, REVIEWER, clock);
    s = addProduct(s, docId, "unknown_item:1", {}, REVIEWER, clock);
    expect(order(s, docId).reviewState).toBe("ready");
    expect(s.approvals).toEqual([]);
    const again = upload(s, REPEAT, clock);
    expect(order(again.state, again.docId).deliveryState).toBe("erp_created");
    expect(again.state.approvals.at(-1)!.kind).toBe("system");
  });

  it("accepts only strict onboarding actions on the server", () => {
    const clock = tickClock();
    const { state: s, docId } = upload(emptyRunState(clock.now()), FIRST, clock);
    const bad = [
      { type: "addCustomer", role: "reviewer", docId, currency: "CA" },
      { type: "addCustomer", role: "reviewer", docId, customerId: "X" },
      { type: "addProduct", role: "reviewer", docId, issueKey: "unknown_item:0", price: "1.00" },
      { type: "addProduct", role: "reviewer", docId, issueKey: "unknown_item:0", moq: 1 },
    ];
    for (const a of bad) expect(applyAction(s, a)).toMatchObject({ ok: false, status: 400 });
    expect(applyAction(s, { type: "addCustomer", role: "viewer", docId })).toMatchObject({ ok: false, status: 403 });
    const ok = applyAction(s, { type: "addCustomer", role: "reviewer", docId, name: "Birchwood Demo Market" });
    expect(ok.ok).toBe(true);
  });
});
