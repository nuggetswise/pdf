// Test helper (D47): a FICTIONAL retailer that is not in the reference data, onboarded from its PO as a real
// supplier would (D46), with valid GTINs, GLNs and SSCCs on the GS1 demonstration prefix 952.
import { INTAKE_ACTOR, REVIEWER, extract, tickClock } from "./demo";
import { gln, gs1CheckDigit } from "../gs1";
import { saveSupplierSetup, saveTradingPartner } from "../partners";
import { type RunState, emptyRunState } from "../run-state";
import { addCustomer, addProduct, approve, receive } from "../workflow";

const clock = { now: () => "2026-10-15T09:30:00.000Z" };
export const gtin = (n: number) => { const body = `9520000${String(n).padStart(5, "0")}`; return body + gs1CheckDigit(body); };
export const G1 = gtin(101);
export const G2 = gtin(102);
export const BUYER = gln("952001000777");
export const DC = gln("952002000777");
export const SUPPLIER = gln("952000000555");

/** A PO from a customer the reference data does not know, with valid (fictional) GTINs, onboarded and delivered. */
export function sessionOrder(): { s: RunState; docId: number } {
  const t = tickClock();
  const text = `FICTIONAL TEST DATA - NOT A REAL CUSTOMER ORDER
PURCHASE ORDER
PO: BW-DEMO-6001
Customer: Birchwood Demo Market
Supplier: Marlow Demo Foods
Currency: EUR
Line | GTIN | Description | Quantity | Unit | Unit price | Amount
1 | ${G1} | Demo maple cookies 300g | 12 | CASE | 12.50 | 150.00
2 | ${G2} | Demo apple chips 150g | 5 | CASE | 9.80 | 49.00
Subtotal: 199.00
Tax amount: 0.00
Shipping amount: 0.00
Total: 199.00
`;
  const r = receive(emptyRunState(t.now()), { messageId: null, sender: null, receivedAt: null, subjectMetadata: null,
    intakeMode: "demo_envelope_upload", rawSha256: null },
  [{ originalFilename: "po.pdf", sha256: "b".repeat(64), sizeBytes: text.length, pageCount: 1, pageText: [text] }], INTAKE_ACTOR, t);
  const docId = r.documentIds[0];
  let s = extract(r.state, docId, t);
  s = addCustomer(s, docId, {}, REVIEWER, t);
  s = addProduct(s, docId, "unknown_item:0", {}, REVIEWER, t);
  s = addProduct(s, docId, "unknown_item:1", {}, REVIEWER, t);
  s = approve(s, docId, REVIEWER, t);
  return { s, docId };
}
export const custId = (s: RunState, docId: number) => s.orders.find((o) => o.documentId === docId)!.validation.order.customer_id!;
export const setUp = (s: RunState, docId: number, profile: "eancom2002" | "mediamarktsaturn" = "eancom2002", extra = {}) => {
  let r = saveSupplierSetup(s, { name: "Marlow Demo Foods", gln: SUPPLIER, vatId: "DE000000000", companyPrefix: "9520000",
    taxType: "VAT", defaultTaxRate: "19" }, REVIEWER, clock);
  r = saveTradingPartner(r, { customerId: custId(s, docId), profile, buyerGln: BUYER, shipToGlns: [
    { shipToId: "(no ship-to on the PO)", gln: DC }], ...extra }, REVIEWER, clock);
  return r;
};
export const ASN = { lines: [{ lineIndex: 0, shippedQty: "12" }, { lineIndex: 1, shippedQty: "5" }], estimatedDelivery: "2026-10-20" };

