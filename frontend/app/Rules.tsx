"use client";
// D74: the supplier's rules in one place. Values such as agreed prices, minimum quantities and lead times come from
// the supplier's ERP; here an administrator sets policy: which orders need a person, and which failed checks are
// accepted automatically, for whom and from when (like a price rule in an accounting system).
import { useState } from "react";
import { mergeReference } from "../lib/domain/onboarding";
import bundledReference from "../lib/domain/reference-data.v1.json";
import type { PolicyRule } from "../lib/domain/run-state";
import { POLICY, TITLES, type IssueCode, type Reference } from "../lib/domain/validation";
import type { Health, Role } from "./api";
import { MemoryView, Supervision } from "./Panels";
import { useAgent } from "./run/RunProvider";

const READS: Record<IssueCode, string> = {
  unknown_customer: "Customers", unknown_ship_to: "Customer ship-to list", missing_po_number: "The document",
  missing_currency: "The document", currency_mismatch: "Customer currency", unverified_field: "The document text",
  missing_line_value: "The document", unknown_item: "Products, customer item codes", unknown_unit: "Unit conversions",
  unit_conversion: "Unit conversions", moq_violation: "Minimum order quantities", price_mismatch: "Agreed prices",
  outdated_identifier: "Retired GTINs and approved replacements", rule_needs_revalidation: "Approved rules",
  line_amount_mismatch: "Printed line amounts", total_mismatch: "Printed totals", possible_revision: "Orders already received",
};
const CHECK_LABEL: Record<PolicyRule["check"], string> = { price_mismatch: "Price differs from agreed price", moq_violation: "Below minimum order quantity" };
const today = () => new Date().toISOString().slice(0, 10);

export function RulesView({ role, health }: { role: Role; health: Health | null }) {
  const [error, setError] = useState<string | null>(null);
  const admin = role === "administrator";
  const codes = Object.keys(POLICY) as IssueCode[];
  return (
    <section className="rules" aria-label="Rules">
      {error && <div className="alert bad" role="alert">{error}</div>}
      <p className="muted small">Agreed prices, minimum quantities and lead times come from your ERP (simulated, fictional data). Rules set what happens when an order does not match them.</p>
      {admin && health ? <Supervision health={health} onError={setError} /> : <p className="placeholder">Only an administrator can change which orders need a person.</p>}
      <Policies admin={admin} onError={setError} />
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

function Policies({ admin, onError }: { admin: boolean; onError: (e: string | null) => void }) {
  const agent = useAgent();
  const ref = mergeReference((agent.state.settings.referenceData as unknown as Reference | null) ?? bundledReference, agent.state.referenceOverlay);
  const rules = agent.state.policyRules ?? [];
  const uses = (id: number) => agent.state.audit.filter((a) => a.event === "policy_applied" && a.actor === `policy:P-${id}`).length;
  const blank = { check: "price_mismatch" as PolicyRule["check"], customerId: "", sku: "", tolerancePercent: "5", effectiveFrom: today(), effectiveTo: "", reason: "" };
  const [form, setForm] = useState<typeof blank | null>(null);
  const customerName = (id: string | null) => (id ? ref.customers.find((c) => c.customer_id === id)?.name ?? id : "All customers");
  const itemName = (sku: string | null) => (sku ? ref.products.find((p) => p.sku === sku)?.description ?? sku : "All items");
  const save = async () => {
    if (!form) return;
    try {
      await agent.run({ type: "addPolicyRule", role: "administrator", check: form.check, customerId: form.customerId || null, sku: form.sku || null,
        tolerancePercent: form.check === "price_mismatch" ? form.tolerancePercent : null, effectiveFrom: form.effectiveFrom,
        effectiveTo: form.effectiveTo || null, reason: form.reason });
      onError(null); setForm(null);
    } catch (e) { onError((e as Error).message); }
  };
  return (
    <section className="panel" aria-labelledby="policies-h">
      <header className="panel-head"><h3 id="policies-h">Order policies</h3><span className="count muted">{rules.filter((r) => !r.endedAt).length}</span>
        {admin && !form && <button className="ghost" onClick={() => setForm(blank)}>Add policy</button>}</header>
      <p className="muted small">Accept a failed check automatically for a customer or item. The decision is recorded on the order with the policy number. Applies to orders received after the policy is saved.</p>
      {form && (
        <fieldset className="policy-form">
          <legend>New order policy</legend>
          <label>Check
            <select value={form.check} onChange={(e) => setForm({ ...form, check: e.target.value as PolicyRule["check"] })}>
              <option value="price_mismatch">{CHECK_LABEL.price_mismatch}</option><option value="moq_violation">{CHECK_LABEL.moq_violation}</option>
            </select></label>
          <label>Customer
            <select value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}>
              <option value="">All customers</option>{ref.customers.map((c) => <option key={c.customer_id} value={c.customer_id}>{c.name}</option>)}
            </select></label>
          <label>Item
            <select value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })}>
              <option value="">All items</option>{ref.products.map((p) => <option key={p.sku} value={p.sku}>{p.sku} {p.description}</option>)}
            </select></label>
          {form.check === "price_mismatch" && <label>Accept when within (%)
            <input className="qty" value={form.tolerancePercent} onChange={(e) => setForm({ ...form, tolerancePercent: e.target.value })} /></label>}
          <label>Effective from<input type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} /></label>
          <label>Until (optional)<input type="date" value={form.effectiveTo} onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })} /></label>
          <label>Reason<input value={form.reason} placeholder="Required" onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
          <div className="btns"><button className="primary" onClick={save}>Save policy</button><button className="ghost" onClick={() => setForm(null)}>Cancel</button></div>
        </fieldset>
      )}
      {rules.length === 0 ? <p className="empty">No order policies. Every failed check waits for a person.</p> : (
        <div className="scroll"><table className="table">
          <thead><tr><th>Policy</th><th>When</th><th>For</th><th>Then</th><th>Dates</th><th>Used</th><th></th></tr></thead>
          <tbody>{rules.map((r) => (
            <tr key={r.id} className={r.endedAt ? "muted" : ""}>
              <td data-label="Policy">P-{r.id}<div className="muted small">{r.reason}</div></td>
              <td data-label="When">{CHECK_LABEL[r.check]}{r.tolerancePercent ? `, within ${r.tolerancePercent}%` : ""}</td>
              <td data-label="For">{customerName(r.customerId)} · {itemName(r.sku)}</td>
              <td data-label="Then">Accept automatically</td>
              <td data-label="Dates">{r.effectiveFrom} to {r.effectiveTo ?? "no end"}{r.endedAt ? " · ended" : ""}</td>
              <td data-label="Used">{uses(r.id)} order{uses(r.id) === 1 ? "" : "s"}</td>
              <td>{admin && !r.endedAt && <button className="ghost tiny" onClick={async () => {
                try { await agent.run({ type: "endPolicyRule", role: "administrator", policyId: r.id }); onError(null); } catch (e) { onError((e as Error).message); }
              }}>End policy</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}
