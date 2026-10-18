"use client";
// D74: the supplier's rules in one place. Values such as agreed prices, minimum quantities and lead times come from
// the supplier's ERP; here an administrator sets policy: which orders need a person, and which failed checks are
// accepted automatically, for whom and from when (like a price rule in an accounting system).
import { useState } from "react";
import { POLICY, TITLES, type IssueCode, type Reference } from "../lib/domain/validation";
import type { Health, Role } from "./api";
import { MemoryView, Supervision } from "./Panels";

const READS: Record<IssueCode, string> = {
  unknown_customer: "Customers", unknown_ship_to: "Customer ship-to list", missing_po_number: "The document",
  missing_currency: "The document", currency_mismatch: "Customer currency", unverified_field: "The document text",
  missing_line_value: "The document", unknown_item: "Products, customer item codes", unknown_unit: "Unit conversions",
  unit_conversion: "Unit conversions", moq_violation: "Minimum order quantities", price_mismatch: "Agreed prices",
  outdated_identifier: "Retired GTINs and approved replacements", rule_needs_revalidation: "Approved rules",
  line_amount_mismatch: "Printed line amounts", total_mismatch: "Printed totals", possible_revision: "Orders already received",
};

export function RulesView({ role, health }: { role: Role; health: Health | null }) {
  const [error, setError] = useState<string | null>(null);
  const admin = role === "administrator";
  const codes = Object.keys(POLICY) as IssueCode[];
  return (
    <section className="rules" aria-label="Rules">
      {error && <div className="alert bad" role="alert">{error}</div>}
      <p className="muted small">Agreed prices, minimum quantities and lead times come from your ERP (simulated, fictional data). Rules set what happens when an order does not match them.</p>
      {admin && health ? <Supervision health={health} onError={setError} /> : <p className="placeholder">Only an administrator can change which orders need a person.</p>}
      <MemoryView role={role} />
      <section className="panel" aria-labelledby="doc-rules-h">
        <header className="panel-head"><h3 id="doc-rules-h">Checks on every order</h3><span className="count muted">{codes.length}</span></header>
        <div className="scroll"><table className="table">
          <thead><tr><th>Check</th><th>Compared with</th><th>Decisions a person can make</th></tr></thead>
          <tbody>{codes.map((c) => (
            <tr key={c}><td data-label="Check">{TITLES[c]}</td><td data-label="Compared with">{READS[c]}</td>
              <td data-label="Decisions">{POLICY[c].actions.length ? POLICY[c].actions.map((a) => a.replace(/_/g, " ")).join(", ") : "Reject, or correct at source"}</td></tr>
          ))}</tbody>
        </table></div>
      </section>
    </section>
  );
}
