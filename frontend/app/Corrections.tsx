"use client";
// Approved corrections: the portal's own memory. A reviewer's correction becomes a candidate rule; an administrator
// activates it for one retailer and item; it applies to later orders and can be revoked. Not model training.
import { useState } from "react";
import { rulesList } from "../lib/domain/selectors";
import type { Role } from "./api";
import { useAgent } from "./run/RunProvider";

const who = (actor: string | null) => (actor ? actor.split(":")[1] ?? actor : "—");

export function Corrections({ role }: { role: Role }) {
  const agent = useAgent();
  const rules = agent.ready ? rulesList(agent.state) : null;
  const [error, setError] = useState<string | null>(null);
  async function setState(id: number, state: "active" | "revoked") {
    try {
      await agent.run({ type: "setRuleState", role, ruleId: id, state, reason: state === "revoked" ? "Revoked from Rules" : null });
      setError(null);
    } catch (e) { setError((e as Error).message); }
  }
  return (
    <section className="memory" aria-label="Approved rules">
      <h3>Approved corrections</h3>
      <p className="muted">A reviewer's correction becomes a candidate rule. An administrator activates it for one retailer and item; it applies to later orders and can be revoked. These belong to the portal, not your ERP. No model is retrained.</p>
      {error && <div className="alert bad" role="alert">{error}</div>}
      {rules?.length === 0 && <p className="placeholder">No approved corrections yet. A correction saved while reviewing an order appears here.</p>}
      {rules?.map((r) => (
        <article key={r.id} className={`rule ${r.state}`}>
          <header>
            <h4>Rule #{r.id}: {r.obsolete_identifier} → {r.replacement_identifier}</h4>
            <span className={`pill ${r.state === "active" ? "ok" : r.state === "candidate" ? "warn" : "muted"}`}>{r.state === "candidate" ? "Candidate (not in use)" : r.state === "active" ? "Active" : "Revoked"}</span>
          </header>
          <dl>
            <div><dt>Scope</dt><dd>Customer {r.customer_id} only · product {r.replacement_sku}</dd></div>
            <div><dt>Learned from</dt><dd>Order #{r.source_document_id}, decision #{r.source_decision_id} by {who(r.created_by)}</dd></div>
            <div><dt>Evidence</dt><dd className="mono">{r.evidence ?? "—"}</dd></div>
            <div><dt>Reference version</dt><dd>{r.reference_version}</dd></div>
            <div><dt>Activated</dt><dd>{r.activated_by ? `${who(r.activated_by)} · ${new Date(r.activated_at!).toLocaleTimeString()}` : "Not activated"}</dd></div>
            {r.revoked_by && <div><dt>Revoked</dt><dd>{who(r.revoked_by)}: {r.revoke_reason}</dd></div>}
            <div><dt>Used on</dt><dd>{r.uses.length ? r.uses.map((u) => `order #${u.document_id}`).join(", ") : "No orders yet"}</dd></div>
          </dl>
          {role === "administrator" && (
            <div className="btns">
              {r.state === "candidate" && <button className="primary" onClick={() => setState(r.id, "active")}>Activate</button>}
              {r.state !== "revoked" && <button className="ghost danger" onClick={() => setState(r.id, "revoked")}>Revoke</button>}
            </div>
          )}
          {role === "reviewer" && r.state === "candidate" && <p className="muted small">Only an administrator can activate this rule.</p>}
        </article>
      ))}
      <SessionAdditions />
    </section>
  );
}

/** D46: customers and products a reviewer added while processing real POs. Session only; reset clears them. */
function SessionAdditions() {
  const agent = useAgent();
  const ov = agent.ready ? agent.state.referenceOverlay : undefined;
  const base = agent.state.settings.referenceData?.reference_version ?? "REF-2026-10-v1";
  const any = ov && ov.customers.length + ov.customerAliases.length + ov.shipTos.length + ov.products.length > 0;
  return (
    <section className="additions" aria-label="Added while reviewing">
      <h3>Added while reviewing orders</h3>
      <p className="muted">Retailers and items a reviewer added from a purchase order that your ERP does not list yet. They apply to checks in this
        session only (reference version {any ? `${base} plus additions` : base}). Add them to your ERP to keep them.</p>
      {!any && <p className="placeholder">Nothing added.</p>}
      {ov && ov.customers.length > 0 && (
        <table className="lines"><thead><tr><th>Customer</th><th>Name</th><th>Currency</th><th>Ship-to</th><th>Added by</th><th>From order</th></tr></thead>
          <tbody>{ov.customers.map((c) => <tr key={c.customerId}><td>{c.customerId}</td><td>{c.name}</td><td>{c.currency}</td>
            <td>{c.shipToIds.join(", ") || "none on file"}</td><td>{who(c.addedBy)}</td><td>#{c.sourceDocumentId}</td></tr>)}</tbody></table>
      )}
      {ov && ov.customerAliases.length > 0 && (
        <table className="lines"><thead><tr><th>Printed as</th><th>Assigned to</th><th>Added by</th><th>From order</th></tr></thead>
          <tbody>{ov.customerAliases.map((a, i) => <tr key={i}><td>{a.printed}</td><td>{a.customerId}</td><td>{who(a.addedBy)}</td><td>#{a.sourceDocumentId}</td></tr>)}</tbody></table>
      )}
      {ov && ov.shipTos.length > 0 && (
        <table className="lines"><thead><tr><th>Ship-to</th><th>Customer</th><th>Added by</th><th>From order</th></tr></thead>
          <tbody>{ov.shipTos.map((s, i) => <tr key={i}><td>{s.shipToId}</td><td>{s.customerId}</td><td>{who(s.addedBy)}</td><td>#{s.sourceDocumentId}</td></tr>)}</tbody></table>
      )}
      {ov && ov.products.length > 0 && (
        <table className="lines"><thead><tr><th>Product</th><th>Identifier</th><th>Customer</th><th>Unit</th><th>Reference price</th><th>Minimum</th><th>Added by</th><th>From order</th></tr></thead>
          <tbody>{ov.products.map((p) => <tr key={p.sku}><td>{p.sku}<div className="muted small">{p.description}</div></td>
            <td>{p.gtin ? `GTIN ${p.gtin}` : `item code ${p.customerItemCode}`}</td><td>{p.customerId}</td><td>{p.unit}</td>
            <td>{p.price} {p.currency}</td><td>{p.moq}</td><td>{who(p.addedBy)}</td><td>#{p.sourceDocumentId}</td></tr>)}</tbody></table>
      )}
    </section>
  );
}

