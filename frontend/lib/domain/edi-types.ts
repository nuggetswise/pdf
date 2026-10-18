// The shapes the supplier portal hands to the X12 builders (x12.ts): parties, lines, packing hierarchy, invoice
// allowances and totals, and the segments an outbound document is made of (D45, D47, D75).
export interface Segment { tag: string; raw: string; meaning: string }
export interface EdiMessage { text: string; segments: Segment[]; messageCount: number }
export interface EdiLine {
  sourceLineId: string; gtin: string | null; sku: string; customerItemCode?: string | null; description: string | null;
  unit: string; quantity: string; orderedQty?: string; unitPrice?: string; orderedPrice?: string; lineAmount?: string; taxRate?: string;
  /** D61 (X12 855 only): what ships when. IA ships on the date, IB backordered to the date, IR will not ship. */
  schedule?: { quantity: string; code: "IA" | "IB" | "IR"; date: string | null }[];
}
export interface EdiParty { gln: string | null; vatId?: string | null; name?: string | null }
export interface EdiParties {
  poNumber: string; currency: string | null;
  supplier: EdiParty; buyer: EdiParty;
  /** Delivery party: its GLN, and the ship-to code printed on the PO for the explanation. */
  deliveryParty: EdiParty & { printedId: string | null };
  /** Contract or EDI agreement reference (RFF+CT), when the retailer requires one. */
  contractRef?: string | null;
  /** D50: supplier's vendor number at the retailer (X12 REF*IA only). */
  vendorNumber?: string | null;
}
export interface EdiCarton { sscc: string; lines: EdiLine[] }
export interface EdiPallet { sscc: string; cartons: EdiCarton[] }
export interface EdiAllowance {
  kind: "allowance" | "charge"; code: string; description: string; percent: string | null; amount: string; taxRate: string;
}
export interface EdiInvoiceTotals {
  lineTotal: string; taxableAmount: string; taxAmount: string; invoiceAmount: string;
  byRate: { rate: string; taxable: string; tax: string }[];
}
