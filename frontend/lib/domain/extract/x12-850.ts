// Structured intake (D62): an ANSI X12 850 purchase order is read field by field from its segments. No AI is
// involved and nothing is converted to a PDF first. Every value keeps the segment it came from as evidence.
// Unit codes are translated with the X12 unit-of-measure code list (355) for the codes listed below; any other
// code is kept as sent, so the unit check stops it for a person.
import { SCHEMA_VERSION } from "../normalise";
import type { ExtractionPayload } from "../run-state";

export const X12_READER = { name: "Structured X12 850 reader (no AI)", isAi: false } as const;

type Field = ExtractionPayload["header"]["po_number"];
const UNIT_CODES: Record<string, string> = { CA: "Case", EA: "Each", BX: "Box", PK: "Pack", PL: "Pallet", DZ: "Dozen" };
const GTIN_QUALIFIERS = new Set(["UP", "UK", "EN", "UA"]);
const SUPPLIER_QUALIFIERS = new Set(["VN", "VP", "VA"]);
const BUYER_QUALIFIERS = new Set(["IN", "BP", "PI"]);

const field = (value: string | null | undefined, evidence: string, notes: string[] = []): Field => {
  const v = value?.trim() ? value.trim() : null;
  return { value: v, page: v ? 1 : null, evidence: v ? evidence : null, evidence_verified: v !== null, notes };
};
const empty = (): Field => ({ value: null, page: null, evidence: null, evidence_verified: false, notes: [] });

/** Splits an interchange into segments using the separators its ISA header declares. */
export function segments(text: string): string[][] {
  const t = text.trim();
  if (!t.startsWith("ISA") || t.length < 106) return [];
  const el = t[3];
  const term = t[105];
  return t.split(term).map((s) => s.replace(/^[\r\n]+/, "").trim()).filter(Boolean).map((s) => s.split(el));
}

/** The 850 in the file as an extraction payload, or null when the file holds no purchase order. */
export function read850(pages: string[]): ExtractionPayload | null {
  const segs = segments(pages.join(""));
  const st = segs.findIndex((s) => s[0] === "ST" && s[1] === "850");
  if (st < 0) return null;
  const header = Object.fromEntries(["customer_name", "customer_id", "supplier", "po_number", "ship_to_id", "order_date",
    "requested_delivery_date", "currency", "subtotal", "tax", "shipping", "total"].map((k) => [k, empty()])) as ExtractionPayload["header"];
  const lines: ExtractionPayload["lines"] = [];
  const terms: NonNullable<ExtractionPayload["terms"]> = {};
  for (const s of segs.slice(st)) {
    const ev = s.join("*");
    if (s[0] === "SE") break;
    if (s[0] === "BEG") { header.po_number = field(s[3], ev); header.order_date = field(s[5], ev); }
    if (s[0] === "CUR" && s[1] === "BY") header.currency = field(s[2], ev);
    if (s[0] === "DTM") {
      if (s[1] === "002") header.requested_delivery_date = field(s[2], ev);
      if (s[1] === "037") terms.ship_not_before = field(s[2], ev);
      if (s[1] === "038" || s[1] === "001") terms.ship_no_later_than = field(s[2], ev);
    }
    if (s[0] === "N1") {
      if (s[1] === "BY") header.customer_name = field(s[2], ev);
      if (s[1] === "ST") header.ship_to_id = field(s[4] || s[2], ev);
      if (s[1] === "SU" || s[1] === "SE") header.supplier = field(s[2], ev);
    }
    if (s[0] === "PO1") {
      const unitCode = s[3]?.trim() ?? "";
      const unit = UNIT_CODES[unitCode];
      const line: ExtractionPayload["lines"][number] = {
        source_line_id: field(s[1], ev), quantity: field(s[2], ev),
        unit: unit ? { ...field(unitCode, ev, [`X12 unit code ${unitCode} = ${unit}`]), value: unit } : field(unitCode, ev),
        unit_price: field(s[4], ev), gtin: empty(), customer_item_code: empty(), description: empty(), line_amount: empty(),
      };
      for (let i = 6; i + 1 < s.length; i += 2) {
        const [q, id] = [s[i], s[i + 1]];
        if (GTIN_QUALIFIERS.has(q) && !line.gtin.value) line.gtin = field(id, ev);
        if (SUPPLIER_QUALIFIERS.has(q) && !line.supplier_sku) line.supplier_sku = field(id, ev);
        if (BUYER_QUALIFIERS.has(q) && !line.customer_item_code.value) line.customer_item_code = field(id, ev);
      }
      lines.push(line);
    }
    if (s[0] === "PID" && lines.length) lines[lines.length - 1].description = field(s[5], ev);
  }
  const payload: ExtractionPayload = { schema_version: SCHEMA_VERSION, extractor: { name: X12_READER.name, is_ai: X12_READER.isAi },
    header, lines };
  if (Object.keys(terms).length) payload.terms = terms;
  return payload;
}
