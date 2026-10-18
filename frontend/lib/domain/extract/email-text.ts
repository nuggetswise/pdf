// TEST ADAPTER for orders written in an email (D62). A deterministic reader of common plain-text order phrasing,
// used in tests and the test reader in place of the AI. Not AI, always labelled as such, and it never looks at a
// file name or a fixture name: it reads only the text. Values are copied as written, never converted.
import { pyStrip } from "../money";

export const EMAIL_TEXT_READER = { name: "TEST ADAPTER (email text reader, not AI extraction)", isAi: false } as const;

type Raw = { value: string; page: number; evidence: string };
const LINE_BREAKS = /\r\n|[\n\r\v\f]/;

const LABELS: [RegExp, string][] = [
  [/^(?:customer|buyer|company|account)\s*(?:name)?\s*[:-]\s*(.+)$/i, "customer_name"],
  [/^(?:customer|account)\s*(?:id|number|no\.?|#)\s*[:-]\s*(.+)$/i, "customer_id"],
  [/^(?:ship[\s-]*to|deliver(?:y)?\s*to|store|dc|location)\s*[:-]\s*(.+)$/i, "ship_to_id"],
  [/^(?:requested\s+delivery(?:\s+date)?|delivery\s+date|deliver\s+by|needed\s+by|required\s+by|due)\s*[:-]\s*(.+)$/i, "requested_delivery_date"],
  [/^(?:order\s+date|po\s+date|date\s+of\s+order)\s*[:-]\s*(.+)$/i, "order_date"],
  [/^currency\s*[:-]\s*(.+)$/i, "currency"],
  [/^supplier\s*[:-]\s*(.+)$/i, "supplier"],
];
const PO = /\b(?:p\.?o\.?|purchase\s+order|order)\s*(?:number|no\.?|#|ref(?:erence)?)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{2,})/i;
// "10 Case of NF-CRK-001 at 24.00", "10 x NF-CRK-001 @ $24.00", "NF-CRK-001 x 10 Case at USD 24.00"
const QTY_FIRST = /^(?:[-*•]\s*)?(\d[\d,]*(?:\.\d+)?)\s*(?:x\s+)?([A-Za-z]{2,10}\s+)?(?:of\s+)?([A-Z0-9][A-Z0-9-]{3,})\b(.*)$/;
const ID_FIRST = /^(?:[-*•]\s*)?([A-Z0-9][A-Z0-9-]{3,})\s*(?:x|qty|quantity)\s*[:]?\s*(\d[\d,]*(?:\.\d+)?)\s*([A-Za-z]{2,10})?\b(.*)$/i;
const PRICE = /(?:at|@)\s*(?:USD|CAD|GBP|EUR|\$|£|€)?\s*(\d[\d,]*\.\d{2})/i;
const CODE = /\b(USD|CAD|GBP|EUR)\b/;
const NOT_UNITS = new Set(["of", "x", "at", "the", "and"]);

function lineFrom(qtyText: string, unitText: string | undefined, id: string, rest: string, evidence: string, n: number) {
  const f = (value: string) => ({ value, page: 1, evidence });
  const unit = unitText?.trim();
  const out: Record<string, Raw> = { source_line_id: f(String(n)), quantity: f(qtyText) };
  if (unit && !NOT_UNITS.has(unit.toLowerCase())) out.unit = f(unit);
  if (/^\d{12,14}$/.test(id)) out.gtin = f(id); else out.supplier_sku = f(id);
  const price = PRICE.exec(rest);
  if (price) out.unit_price = f(price[1]);
  return out;
}

/** Reads an order from email text. Returns empty header and lines when the text holds no order. */
export function emailTextExtract(pages: string[]) {
  const header: Record<string, Raw> = {};
  const lines: Record<string, Raw>[] = [];
  const text = pages.join("\n");
  const rows = text.split(LINE_BREAKS).map(pyStrip).filter(Boolean);
  for (const row of rows) {
    if (/^(?:>|from:|sent:|to:|subject:)/i.test(row)) continue; // quoted history and forwarded headers
    let labelled = false;
    for (const [re, field] of LABELS) {
      const m = re.exec(row);
      if (m && !(field in header)) { header[field] = { value: pyStrip(m[1]), page: 1, evidence: row }; labelled = true; break; }
    }
    if (labelled) continue;
    if (!header.po_number) {
      const m = PO.exec(row);
      if (m && /\d/.test(m[1])) header.po_number = { value: m[1], page: 1, evidence: row };
    }
    const q = QTY_FIRST.exec(row);
    if (q && /\d/.test(q[3])) { lines.push(lineFrom(q[1], q[2], q[3], q[4], row, lines.length + 1)); continue; }
    const i = ID_FIRST.exec(row);
    if (i && /\d/.test(i[1]) && !PO.test(row)) lines.push(lineFrom(i[2], i[3], i[1], i[4], row, lines.length + 1));
  }
  if (!header.currency) {
    const row = rows.find((r) => CODE.test(r));
    if (row) header.currency = { value: CODE.exec(row)![1], page: 1, evidence: row };
  }
  return { header, lines };
}
