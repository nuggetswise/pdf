// Port of extraction.py normalise(): turns any extractor's raw result into the fixed payload shape and
// checks every value against the PDF text (D14). Document text is untrusted data throughout.
import { Dec, PY_WHITESPACE_RUN, pyStrip } from "./money";
import { type ExtractionPayload, type OrderTerms, termFields } from "./run-state";

export const HEADER_FIELDS = ["customer_name", "customer_id", "supplier", "po_number", "ship_to_id", "order_date",
  "requested_delivery_date", "currency", "subtotal", "tax", "shipping", "total"] as const;
export const LINE_FIELDS = ["source_line_id", "gtin", "customer_item_code", "description", "quantity", "unit",
  "unit_price", "line_amount"] as const;
const NUMERIC_FIELDS = new Set(["subtotal", "tax", "shipping", "total", "quantity", "unit_price", "line_amount"]);
export const SCHEMA_VERSION = "order-extraction-v1";

export interface ExtractorInfo { name: string; isAi: boolean }
type RawResult = { header?: unknown; lines?: unknown; terms?: unknown };
type Field = ExtractionPayload["header"]["po_number"];

const squash = (text: string): string => pyStrip(text.replace(PY_WHITESPACE_RUN, " ")).toLowerCase();

const isDict = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Python str() of a JSON scalar. Floats with a fractional zero (24.0) cannot be told apart in JavaScript;
 *  the extraction schema asks for strings, so that case does not arise in practice (D33). */
function pyStr(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "number") return String(v);
  return JSON.stringify(v);
}

function normaliseField(name: string, rawIn: unknown, pages: string[]): Field {
  const raw = isDict(rawIn) ? rawIn : { value: rawIn };
  const v = raw.value;
  const value = v === "" || v === null || v === undefined ? null : pyStrip(pyStr(v));
  const ev = raw.evidence;
  const evidence = ev === "" || ev === null || ev === undefined ? null : pyStr(ev);
  let page: number | null = typeof raw.page === "number" && Number.isInteger(raw.page) && raw.page >= 1
    && raw.page <= pages.length ? raw.page : null;
  const notes: string[] = [];
  let verified = false;
  if (value !== null) {
    const haystacks = page ? [pages[page - 1]] : pages;
    const needle = squash(value);
    verified = haystacks.some((h) => squash(h).includes(needle));
    if (!verified) notes.push("value not found in source text");
    if (page === null) {
      const i = pages.findIndex((h) => squash(h).includes(needle));
      page = i >= 0 ? i + 1 : null;
    }
  }
  if (NUMERIC_FIELDS.has(name) && value !== null && Dec.parse(value.replace(/,/g, "")) === null) {
    notes.push("not a valid decimal number");
  }
  return { value, page, evidence, evidence_verified: verified, notes };
}

export function normalise(result: RawResult, pages: string[], extractor: ExtractorInfo): ExtractionPayload {
  const headerIn = isDict(result.header) ? result.header : {};
  const header = Object.fromEntries(HEADER_FIELDS.map((f) => [f, normaliseField(f, headerIn[f], pages)]));
  const linesIn = Array.isArray(result.lines) ? result.lines : [];
  const lines = linesIn.map((raw) => {
    const line = isDict(raw) ? raw : {};
    const out: Record<string, Field> = Object.fromEntries(LINE_FIELDS.map((f) => [f, normaliseField(f, line[f], pages)]));
    const sku = line.supplier_sku;
    if (sku !== undefined && sku !== null && sku !== "" && !(isDict(sku) && (sku.value === null || sku.value === ""))) {
      out.supplier_sku = normaliseField("supplier_sku", sku, pages);
    }
    return out;
  });
  const payload: ExtractionPayload = {
    schema_version: SCHEMA_VERSION,
    extractor: { name: extractor.name, is_ai: extractor.isAi },
    header: header as ExtractionPayload["header"],
    lines: lines as ExtractionPayload["lines"],
  };
  const terms = normaliseTerms(result.terms, pages);
  if (terms) payload.terms = terms;
  return payload;
}

/** D59: order terms and printed instructions, checked against the page text like every other value. Present only
 *  when the extractor returned some; the instructions are kept as text for a person and never acted on. */
export function normaliseTerms(raw: unknown, pages: string[]): OrderTerms | undefined {
  if (!isDict(raw)) return undefined;
  const out: OrderTerms = {};
  for (const f of termFields) {
    const v = raw[f];
    if (v === undefined || v === null || v === "") continue;
    const field = normaliseField(f, v, pages);
    if (field.value !== null) out[f] = field;
  }
  if (Array.isArray(raw.instructions)) {
    const list = raw.instructions.slice(0, 30).map((v) => normaliseField("instruction", v, pages)).filter((f) => f.value !== null);
    if (list.length) out.instructions = list;
  }
  return Object.keys(out).length ? out : undefined;
}
