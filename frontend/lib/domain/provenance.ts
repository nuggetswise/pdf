// D65: where each order value came from, kept as separate statements: how it was read, whether the text was found
// in the source, whether it sits on the line it was read for, what reference data matched, and what a person
// confirmed. No confidence numbers: finding a value in the text does not prove it was read correctly.
import type { DocDetail, Issue } from "./selectors";

export type ProvenanceRow = {
  id: string;
  label: string;
  value: string | null;
  /** How the value was read: AI model, structured EDI reader, or the test adapter. */
  readBy: string;
  readKind: "ai" | "structured" | "test";
  found: "found" | "not_found" | "no_value";
  /** Placement: the value is on the row of the line it was read for (lines only). */
  placement: "on_line" | "other_line" | "not_checked";
  reference: string | null;
  person: string | null;
};

const HEADER: [string, string][] = [
  ["po_number", "PO number"], ["customer_name", "Customer"], ["ship_to_id", "Ship-to"], ["order_date", "Order date"],
  ["requested_delivery_date", "Requested delivery"], ["currency", "Currency"], ["total", "Total"],
];
const LINE: [string, string][] = [["identifier", "Item"], ["quantity", "Quantity"], ["unit_price", "Unit price"]];
const ISSUE_FIELD: Record<string, string> = {
  moq_violation: "quantity", price_mismatch: "unit_price", outdated_identifier: "identifier", unknown_item: "identifier",
  rule_needs_revalidation: "identifier", unknown_customer: "customer_name", unknown_ship_to: "ship_to_id",
  currency_mismatch: "currency", total_mismatch: "total", possible_revision: "po_number", source_conflict: "po_number",
};
const fieldOf = (i: Issue) => {
  if (i.code === "ambiguous_date" || i.code === "unclear_date" || i.code === "unverified_field" || i.code === "value_not_on_line") {
    return i.field ?? null;
  }
  return ISSUE_FIELD[i.code] ?? null;
};
const personOf = (issues: Issue[]) => {
  const r = issues.find((i) => i.resolution && !i.resolution.actor.startsWith("system:"))?.resolution;
  return r ? `${r.actor.split(":")[1] ?? r.actor}: ${r.action.replace(/_/g, " ")}` : null;
};

export function provenanceRows(d: DocDetail): ProvenanceRow[] {
  const p = d.latest_version?.payload;
  if (!p) return [];
  const o = d.order?.validation;
  const issues = o?.issues ?? [];
  const readKind: ProvenanceRow["readKind"] = p.extractor.is_ai ? "ai" : /X12|EDI/i.test(p.extractor.name) ? "structured" : "test";
  const readBy = readKind === "ai" ? `AI (${p.extractor.name})` : readKind === "structured" ? "Structured EDI reader (no AI)" : "Test adapter (not AI)";
  const found = (f: { value: string | null; evidence_verified: boolean } | undefined): ProvenanceRow["found"] =>
    !f?.value ? "no_value" : f.evidence_verified ? "found" : "not_found";
  const rows: ProvenanceRow[] = [];
  for (const [k, label] of HEADER) {
    const f = p.header[k];
    const about = issues.filter((i) => i.line_index === null && fieldOf(i) === k);
    let reference: string | null = null;
    if (k === "customer_name" && o?.order.customer_id) reference = `Customer ${o.order.customer_id}`;
    if (k === "ship_to_id" && o?.order.ship_to_id && !about.some((i) => i.status === "open")) {
      reference = (o.order as { printed_ship_to_id?: string | null }).printed_ship_to_id
        ? `Chosen location ${o.order.ship_to_id}` : `Location ${o.order.ship_to_id} on file`;
    }
    if (k === "total" && o?.order.totals.computed_total) reference = `Calculated ${o.order.totals.computed_total}`;
    const dates = (o?.order as { resolved_dates?: Record<string, string> } | undefined)?.resolved_dates;
    if (dates?.[k]) reference = `Chosen date ${dates[k]}`;
    rows.push({ id: `h:${k}`, label, value: f?.value ?? null, readBy, readKind, found: found(f), placement: "not_checked",
      reference, person: personOf(about) });
  }
  p.lines.forEach((l, idx) => {
    const line = o?.order.lines.find((x) => x.line_index === idx);
    const lineIssues = issues.filter((i) => i.line_index === idx);
    // The placement check (checks.ts) runs only when both the item identifier and the value were found in the text.
    const idFound = [l.gtin, l.customer_item_code, l.supplier_sku].some((x) => x?.value && x.evidence_verified);
    for (const [k, label] of LINE) {
      const f = k === "identifier" ? [l.gtin, l.customer_item_code, l.supplier_sku].find((x) => x?.value) : l[k];
      const about = lineIssues.filter((i) => fieldOf(i) === k);
      const misplaced = about.some((i) => i.code === "value_not_on_line");
      let reference: string | null = null;
      if (k === "identifier" && line?.sku) reference = line.resolved_by?.type === "memory_rule" ? `Product ${line.sku} (approved memory rule)` : `Product ${line.sku}`;
      if (k === "unit_price" && line?.sku && !about.some((i) => i.code === "price_mismatch")) reference = "Matches the price list";
      if (k === "quantity" && line?.sku && !about.some((i) => i.code === "moq_violation")) reference = "Meets the minimum order";
      rows.push({ id: `l:${idx}:${k}`, label: `Line ${l.source_line_id?.value ?? idx + 1} · ${label}`, value: f?.value ?? null,
        readBy, readKind, found: found(f), placement: misplaced ? "other_line" : k !== "identifier" && idFound && f?.evidence_verified ? "on_line" : "not_checked",
        reference, person: personOf(about) });
    }
  });
  return rows;
}
