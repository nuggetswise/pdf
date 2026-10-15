// TEST ADAPTER: deterministic parser for the labelled fictional fixture layout (extraction.py
// FixtureTestExtractor). Not AI, and always labelled as such (D15). Used for tests and rehearsal mode.
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
