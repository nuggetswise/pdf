// TEST ADAPTER: deterministic parser for the labelled fictional fixture layout (extraction.py
// FixtureTestExtractor). Not AI, and always labelled as such (D15). Used for tests and the test reader.
import { pyStrip } from "../money";

export const FIXTURE_EXTRACTOR = { name: "TEST ADAPTER (fixture parser, not AI extraction)", isAi: false } as const;

const HEADER_KEYS = new Map<string, string>(Object.entries({
  po: "po_number", customer: "customer_name", "customer id": "customer_id", supplier: "supplier",
  "ship-to": "ship_to_id", "order date": "order_date", "requested delivery date": "requested_delivery_date",
  currency: "currency", subtotal: "subtotal", "tax amount": "tax", "shipping amount": "shipping", total: "total",
}));
const COLUMN_KEYS = new Map<string, string>(Object.entries({
  line: "source_line_id", gtin: "gtin", "customer item": "customer_item_code", description: "description",
  quantity: "quantity", unit: "unit", "unit price": "unit_price", amount: "line_amount",
}));

/** Python str.splitlines() boundaries. */
const LINE_BREAKS = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;

type RawField = { value: string; page: number; evidence: string };

export function fixtureExtract(pages: string[]): { header: Record<string, RawField>; lines: Record<string, RawField>[] } {
  const header: Record<string, RawField> = {};  // keys come only from HEADER_KEYS
  const lines: Record<string, RawField>[] = [];
  let columns: string[] | null = null;
  pages.forEach((text, i) => {
    const pageNo = i + 1;
    const rows = text.split(LINE_BREAKS);
    if (rows.length && rows[rows.length - 1] === "") rows.pop();
    for (const raw of rows) {
      const line = pyStrip(raw);
      if (line.includes("|")) {
        const cells = line.split("|").map(pyStrip);
        const keys: (string | undefined)[] = cells.map((c) => COLUMN_KEYS.get(c.toLowerCase()));
        if (keys.every(Boolean)) { columns = keys as string[]; continue; }
        if (columns && cells.length === columns.length) {
          const cols: string[] = columns;
          lines.push(Object.fromEntries(cells.map((v, j) => [cols[j], { value: v, page: pageNo, evidence: line }])));
        }
        continue;
      }
      const colon = line.indexOf(":");
      if (colon >= 0) {
        const field = HEADER_KEYS.get(pyStrip(line.slice(0, colon)).toLowerCase());
        if (field && !(field in header)) {
          header[field] = { value: pyStrip(line.slice(colon + 1)), page: pageNo, evidence: line };
        }
      }
    }
  });
  return { header, lines };
}

// ---- second test layout: retailer-style PO (D60), labels above values and a supplier-SKU table ----
type Raw = { value: string; page: number; evidence: string };
const NEXT_LINE_LABELS: Record<string, string> = {
  "po number": "po_number", "po date": "order_date", "requested delivery": "requested_delivery_date", currency: "currency",
  buyer: "customer_name", supplier: "supplier",
};
const TERM_LABELS: Record<string, string> = {
  "payment terms": "payment_terms", "ship window": "ship_window", "delivery window": "delivery_window",
};
const TOTAL_LABELS: [RegExp, string][] = [[/^merchandise total\b/i, "subtotal"], [/^freight\b/i, "shipping"],
  [/^sales tax\b/i, "tax"], [/^total purchase order value\b/i, "total"]];
const ROW = /^(\d+) (\S+) (.+) (\S+) (\d[\d,]*(?:\.\d+)?) (?:USD |\$)?([\d,]+\.\d+) (?:USD |\$)?([\d,]+\.\d+)$/;

/** True when the page text has the retailer-style table this adapter reads. */
export const isRetailerLayout = (pages: string[]) => pages.some((p) => /\bSUPPLIER SKU\b/.test(p));

export function retailerLayoutExtract(pages: string[]) {
  const header: Record<string, Raw> = {};
  const lines: Record<string, Raw>[] = [];
  const terms: Record<string, Raw> = {};
  const instructions: Raw[] = [];
  pages.forEach((text, i) => {
    const page = i + 1;
    const rows = text.split(LINE_BREAKS).map(pyStrip).filter(Boolean);
    rows.forEach((line, j) => {
      const next = rows[j + 1];
      const label = line.toLowerCase();
      const at = (value: string) => ({ value, page, evidence: `${line} ${value}` });
      if (NEXT_LINE_LABELS[label] && next && !(NEXT_LINE_LABELS[label] in header)) header[NEXT_LINE_LABELS[label]] = at(next);
      if (TERM_LABELS[label] && next && !(TERM_LABELS[label] in terms)) terms[TERM_LABELS[label]] = at(next);
      const m = ROW.exec(line);
      if (m) {
        const f = (value: string) => ({ value, page, evidence: line });
        // An item column holding a 12 to 14 digit number is a GTIN; anything else is the supplier's own item number.
        const id: Record<string, Raw> = /^\d{12,14}$/.test(m[2]) ? { gtin: f(m[2]) } : { supplier_sku: f(m[2]) };
        lines.push({ source_line_id: f(m[1]), ...id, description: f(m[3]), unit: f(m[4]),
          quantity: f(m[5]), unit_price: f(m[6]), line_amount: f(m[7]) });
        return;
      }
      const shipTo = /^ship-to id:\s*(.+)$/i.exec(line);
      if (shipTo && !("ship_to_id" in header)) header.ship_to_id = at(shipTo[1]);
      for (const [re, field] of TOTAL_LABELS) {
        const t = re.exec(line);
        const amount = /([\d,]+\.\d+)$/.exec(line);
        if (t && amount && !(field in header)) header[field] = { value: amount[1], page, evidence: line };
      }
      const inc = /^incoterms:\s*(.+)$/i.exec(line);
      if (inc && !terms.freight_terms) terms.freight_terms = { value: inc[1], page, evidence: line };
      const bullet = /^[•\-*]\s+(.+)$/.exec(line);
      if (bullet) {
        instructions.push({ value: bullet[1], page, evidence: line });
        if (/ship complete/i.test(bullet[1]) && !terms.ship_complete) terms.ship_complete = { value: bullet[1], page, evidence: line };
      }
    });
  });
  const window = terms.ship_window;
  delete terms.ship_window;
  if (window) {
    const parts = window.value.split(/\s+(?:-|–|to)\s+/);
    if (parts.length === 2) {
      terms.ship_not_before = { ...window, value: parts[0] };
      terms.ship_no_later_than = { ...window, value: parts[1] };
    }
  }
  return { header, lines, terms: { ...terms, ...(instructions.length ? { instructions } : {}) } };
}

/** The test adapter: whichever of the two fictional layouts the text is in. */
export function fixtureExtractAny(pages: string[]) {
  return isRetailerLayout(pages) ? retailerLayoutExtract(pages) : fixtureExtract(pages);
}
