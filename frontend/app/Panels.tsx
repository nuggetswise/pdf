"use client";
import type React from "react";
import { SAMPLE_LABELS } from "../lib/intake/intake";
import { useState } from "react";
import { documentDetail, documentsList, erpOrdersList, rulesList } from "../lib/domain/selectors";
import { Health, Issue, PROCESS_LABEL, Role } from "./api";
import { OrderView } from "./OrderView";
import { EdiSetting } from "./Portal";
import { DEMO_EMAILS, useAgent } from "./run/RunProvider";

const who = (actor: string | null) => (actor ? actor.split(":")[1] ?? actor : "—");

export function MemoryView({ role }: { role: Role }) {
  const agent = useAgent();
  const rules = agent.ready ? rulesList(agent.state) : null;
  const [error, setError] = useState<string | null>(null);
  async function setState(id: number, state: "active" | "revoked") {
    try {
      await agent.run({ type: "setRuleState", role, ruleId: id, state, reason: state === "revoked" ? "Revoked from the memory screen" : null });
      setError(null);
    } catch (e) { setError((e as Error).message); }
  }
  return (
    <section className="memory" aria-label="Agent memory">
      <div className="eyebrow">Agent memory</div>
      <h3>Approved corrections the agent may reuse</h3>
      <p className="muted">A reviewer's correction becomes a candidate. Only an administrator can activate it. It applies only within its scope, to future orders, and can be revoked. This is rule reuse, not model training.</p>
      {error && <div className="alert bad" role="alert">{error}</div>}
      {rules?.length === 0 && <p className="placeholder">No memory yet. Corrections saved for future orders appear here.</p>}
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
    <section className="additions" aria-label="Added in this session">
      <h3>Added in this session</h3>
      <p className="muted">Customers and products a reviewer added from real purchase orders. They are used for validation
        in this browser tab only (reference version {any ? `${base} + session additions` : base}).
        The reference data file is not changed.</p>
      {!any && <p className="placeholder">Nothing added yet.</p>}
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

export function ErpView() {
  const agent = useAgent();
  const orders = agent.ready ? erpOrdersList(agent.state) : null;
  return (
    <section className="erp-list" aria-label="ERP simulator records">
      <div className="eyebrow">ERP simulator (held in this browser tab, not a live ERP)</div>
      <h3>{orders?.length ?? 0} order{orders?.length === 1 ? "" : "s"} in the ERP</h3>
      {orders?.length === 0 && <p className="placeholder">Nothing delivered yet.</p>}
      <div className="erp-cards">
        {orders?.map((e) => (
          <article key={e.erp_order_id} className="erp-card">
            <h4>{e.erp_order_id}</h4>
            <p>{e.payload.order.po_number} · {e.payload.order.customer_name}</p>
            <p><b>{e.payload.order.totals.printed_total} {e.payload.order.currency}</b> · {e.payload.order.lines.length} lines</p>
            <p className="muted small">{e.payload.approval.kind === "system" ? "Approved by policy (Exception-only)" : `Approved by ${who(e.payload.approval.actor)}`} · version {e.payload.approved_version}</p>
            <p className="mono small">key {e.idempotency_key}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function Workspace({ role, focus = null }: { role: Role; focus?: number | null }) {
  const agent = useAgent();
  const docs = agent.ready ? documentsList(agent.state) : null;
  const emails: readonly string[] = DEMO_EMAILS;
  const [pick, setPick] = useState<string>(DEMO_EMAILS[0]);
  const [selected, setSelected] = useState<number | null>(focus);
  const detail = selected === null ? null : documentDetail(agent.state, selected);
  const [error, setError] = useState<string | null>(null);

  async function wrap(f: () => Promise<unknown>) {
    try { await f(); setError(null); } catch (e) { setError((e as Error).message); }
  }
  /** A dropped or chosen file: a PDF goes in directly, an .eml is read as a forwarded email. */
  const addFile = (f: File) => wrap(async () => {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name) || new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
    const ids = isPdf ? await agent.uploadPdf(bytes, f.name) : await agent.importEml(bytes);
    setSelected(ids[0]);
  });
  const act = async (issue: Issue, action: string, reason: string, params: Record<string, unknown>) =>
    wrap(() => agent.run({ type: "decide", role, docId: selected!, issueKey: issue.key, action: action as never,
      reason: reason || null, params }));

  return (
    <div className="workspace">
      <aside className="inbox" aria-label="Inbox" onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) addFile(f); }}>
        <h3>Inbox</h3>
        <label className="dropzone">
          <input type="file" accept=".pdf,application/pdf,.eml,message/rfc822" aria-label="Upload a purchase order"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) addFile(f); }} />
          <b>Upload a purchase order</b>
          <span className="muted small">PDF, or a forwarded email (.eml) with the PDF attached. Drop it here or click to choose. The file is read in your browser; only its text is sent for extraction.</span>
        </label>
        <div className="samples">
          <span className="muted small">No PDF to hand? Try a sample purchase order (fictional):</span>
          <div className="forward">
            <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Sample purchase order">
              {emails.map((n) => <option key={n} value={n}>{SAMPLE_LABELS[n as keyof typeof SAMPLE_LABELS] ?? n}</option>)}
            </select>
            <button disabled={!pick} onClick={() => wrap(async () => {
              const ids = await agent.forwardDemo(pick);
              setSelected(ids[0]);
            })}>Open sample</button>
          </div>
        </div>
        {docs?.length === 0 && <p className="placeholder">No orders yet. Upload a PDF purchase order to start.</p>}
        {docs?.map((d) => (
          <button key={d.id} className={`mail ${selected === d.id ? "active" : ""}`} onClick={() => setSelected(d.id)}>
            <span className="from">{d.subject_metadata?.replace(/^Fwd: /, "").replace(" [FICTIONAL TEST DATA]", "") ?? d.original_filename}</span>
            <span className="meta"><span>{d.sender}</span><span className={`pill ${PROCESS_LABEL[d.status]?.[1] ?? "info"}`}>{PROCESS_LABEL[d.status]?.[0] ?? d.status}</span></span>
          </button>
        ))}
      </aside>
      <section className="main">
        {error && <div className="alert bad" role="alert">{error}</div>}
        {!detail ? <div className="placeholder">Upload a purchase order, or select one in the inbox to see how the agent handled it.</div> : (
          <>
            {detail.document.status === "extraction_failed" || detail.document.status === "extraction_unavailable" ? (
              <button onClick={() => wrap(() => agent.retryExtraction(detail.document.id))}>Retry extraction</button>
            ) : null}
            <OrderView d={detail} role={role} onAct={act}
              onRun={(a) => wrap(() => agent.run(a))}
              onApprove={() => wrap(() => agent.run({ type: "approve", role, docId: detail.document.id }))}
              onRetry={() => wrap(() => agent.run({ type: "retryDelivery", role, docId: detail.document.id }))} />
          </>
        )}
      </section>
    </div>
  );
}

/** Settings live on their own tab so the inbox shows only what a supplier needs to process an order. */
export function SettingsView({ role, health, pilot }: { role: Role; health: Health | null; pilot?: React.ReactNode }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="settings" aria-label="Settings">
      {error && <div className="alert bad" role="alert">{error}</div>}
      {pilot}
      {role !== "administrator" ? <p className="placeholder">Only an administrator can change settings.</p>
        : health ? <AdminSettings health={health} onError={setError} /> : <p className="placeholder">Loading…</p>}
    </section>
  );
}

function AdminSettings({ health, onError }: { health: Health; onError: (e: string | null) => void }) {
  const agent = useAgent();
  async function go(f: () => Promise<unknown>) {
    try { await f(); onError(null); } catch (e) { onError((e as Error).message); }
  }
  const test = health.extractor_mode === "test";
  const setting = (key: "rehearsal_mode" | "erp_failure_mode", value: string) =>
    go(() => agent.run({ type: "setDemoSetting", role: "administrator", key, value }));
  return (
    <div className="admin">
      <h3>Administrator settings</h3>
      <label>When an order passes every check
        <select aria-label="Clean orders" value={health.policy.mode} onChange={(e) => go(() => agent.run({ type: "setPolicy", role: "administrator", mode: e.target.value }))}>
          <option value="review_all">Wait for a person to approve it</option>
          <option value="exception_only">Put it in the ERP automatically</option>
        </select>
      </label>
      <EdiSetting onError={onError} />
      {test && <>
      <h3>Test controls</h3>
      <p className="muted small">Shown only when the app runs with the test adapter, never with the AI.</p>
      <label>Rehearsal mode (TEST ADAPTER, not AI)
        <select value={health.rehearsal_mode ? "on" : "off"} onChange={(e) => setting("rehearsal_mode", e.target.value)}>
          <option value="off">Off</option><option value="on">On</option>
        </select>
      </label>
      <label>ERP simulator next call
        <select value={health.erp_failure_mode} onChange={(e) => setting("erp_failure_mode", e.target.value)}>
          <option value="none">Succeeds</option><option value="fail_next">Fails</option><option value="timeout_next">Times out after creating</option>
        </select>
      </label>
      <button className="ghost danger" onClick={async () => {
        if (!confirm("Clear everything in this browser tab?")) return;
        await go(() => agent.resetDemo());
      }}>Clear this tab</button>
      </>}
    </div>
  );
}
