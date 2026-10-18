"use client";
// D73: the checks behind every exception, in one place. Order checks apply to the sample inbox; document checks
// apply to uploaded and forwarded documents after AI extraction. Both read fictional reference data.
import { ORDER_RULES } from "../lib/domain/ops/engine";
import { CATALOGUE } from "../lib/domain/ops/reference";
import { POLICY, TITLES, type IssueCode } from "../lib/domain/validation";

const READS: Record<IssueCode, string> = {
  unknown_customer: "Customers", unknown_ship_to: "Customer ship-to list", missing_po_number: "The document",
  missing_currency: "The document", currency_mismatch: "Customer currency", unverified_field: "The document text",
  missing_line_value: "The document", unknown_item: "Products, customer aliases", unknown_unit: "Unit conversions",
  unit_conversion: "Unit conversions", moq_violation: "Minimum order quantities", price_mismatch: "Agreed prices",
  outdated_identifier: "Retired GTINs and approved mappings", rule_needs_revalidation: "Approved rules",
  line_amount_mismatch: "Printed line amounts", total_mismatch: "Printed totals", possible_revision: "Documents received",
};

export function RulesView() {
  const codes = Object.keys(POLICY) as IssueCode[];
  return (
    <section className="rules" aria-label="Rules">
      <p className="muted small">Fictional reference data. AI extracts fields from documents; these rules decide what needs a person.</p>
      <section className="panel" aria-labelledby="order-rules-h">
        <header className="panel-head"><h3 id="order-rules-h">Order checks</h3><span className="count muted">{ORDER_RULES.length}</span></header>
        <table className="table">
          <thead><tr><th>Rule</th><th>Check</th><th>Reads</th><th>Resolved by</th></tr></thead>
          <tbody>{ORDER_RULES.map((r) => (
            <tr key={r.id}><td data-label="Rule">{r.id}</td><td data-label="Check">{r.text}</td><td data-label="Reads">{r.reads}</td><td data-label="Resolved by">{r.owner}</td></tr>
          ))}</tbody>
        </table>
        <details><summary>Lead times</summary>
          <ul className="small">{CATALOGUE.map((i) => <li key={i.sku}>{i.sku} {i.description}: {i.leadDays} days</li>)}</ul>
        </details>
      </section>
      <section className="panel" aria-labelledby="doc-rules-h">
        <header className="panel-head"><h3 id="doc-rules-h">Document checks</h3><span className="count muted">{codes.length}</span></header>
        <table className="table">
          <thead><tr><th>Check</th><th>Reads</th><th>Decisions allowed</th></tr></thead>
          <tbody>{codes.map((c) => (
            <tr key={c}><td data-label="Check">{TITLES[c]}</td><td data-label="Reads">{READS[c]}</td>
              <td data-label="Decisions allowed">{POLICY[c].actions.length ? POLICY[c].actions.map((a) => a.replace(/_/g, " ")).join(", ") : "Reject, or correct at source"}</td></tr>
          ))}</tbody>
        </table>
      </section>
    </section>
  );
}
