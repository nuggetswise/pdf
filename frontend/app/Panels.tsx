"use client";
import { useCallback, useEffect, useState } from "react";
import { api, every, DocDetail, DocSummary, ErpOrder, Health, Issue, PROCESS_LABEL, Role, Rule } from "./api";
import { OrderView } from "./OrderView";

function usePoll<T>(path: string, ms = 1200): [T | null, () => void] {
  const [data, setData] = useState<T | null>(null);
  const load = useCallback(() => { api<T>(path).then(setData).catch(() => {}); }, [path]);
  useEffect(() => { load(); return every(load, ms); }, [load, ms]);
  return [data, load];
}

const who = (actor: string | null) => (actor ? actor.split(":")[1] ?? actor : "—");

export function MemoryView({ role }: { role: Role }) {
  const [rules, reload] = usePoll<Rule[]>("/api/memory-rules");
  const [error, setError] = useState<string | null>(null);
  async function setState(id: number, state: "active" | "revoked") {
    try {
      await api(`/api/memory-rules/${id}/state`, { method: "POST", role, json: { state, reason: state === "revoked" ? "Revoked from the memory screen" : null } });
      setError(null); reload();
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
    </section>
  );
}

export function ErpView() {
  const [orders] = usePoll<ErpOrder[]>("/api/erp/orders");
  return (
    <section className="erp-list" aria-label="ERP simulator records">
      <div className="eyebrow">ERP simulator (local, persistent, not a live ERP)</div>
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

export function Workspace({ role, health, refreshHealth }: { role: Role; health: Health | null; refreshHealth: () => void }) {
  const [docs] = usePoll<DocSummary[]>("/api/documents");
  const [emails, setEmails] = useState<string[]>([]);
  const [pick, setPick] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<DocDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api<string[]>("/api/demo/emails").then((l) => { setEmails(l); setPick(l[0] ?? ""); }).catch(() => {}); }, []);
  useEffect(() => {
    if (selected === null) return;
    const load = () => api<DocDetail>(`/api/documents/${selected}`).then(setDetail).catch(() => {});
    load(); return every(load, 1000);
  }, [selected]);

  async function wrap(f: () => Promise<unknown>) {
    try { await f(); setError(null); refreshHealth(); } catch (e) { setError((e as Error).message); }
  }
  const act = async (issue: Issue, action: string, reason: string, params: Record<string, unknown>) =>
    wrap(() => api(`/api/documents/${selected}/decisions`, { method: "POST", role, json: { issue_key: issue.key, action, reason: reason || null, params } }));

  return (
    <div className="workspace">
      <aside className="inbox" aria-label="Local demo inbox">
        <h3>Inbox</h3>
        <div className="forward">
          <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Demo email">
            {emails.map((n) => <option key={n}>{n}</option>)}
          </select>
          <button className="primary" disabled={!pick} onClick={() => wrap(async () => {
            const r = await api<{ document_ids: number[] }>(`/api/demo/forward/${encodeURIComponent(pick)}`, { method: "POST" });
            setSelected(r.document_ids[0]);
          })}>Forward to agent</button>
        </div>
        <p className="muted small">Imports a local fictional .eml. Nothing is sent over the internet.</p>
        <label className="muted small upload">Or import an .eml file{" "}
          <input type="file" accept=".eml,message/rfc822" onChange={(e) => {
            const f = e.target.files?.[0]; if (!f) return;
            const body = new FormData(); body.append("file", f);
            wrap(async () => { const r = await api<{ document_ids: number[] }>("/api/intake/eml", { method: "POST", body }); setSelected(r.document_ids[0]); });
          }} />
        </label>
        {docs?.length === 0 && <p className="placeholder">No forwarded emails yet.</p>}
        {docs?.map((d) => (
          <button key={d.id} className={`mail ${selected === d.id ? "active" : ""}`} onClick={() => setSelected(d.id)}>
            <span className="from">{d.subject_metadata?.replace(/^Fwd: /, "").replace(" [FICTIONAL TEST DATA]", "") ?? d.original_filename}</span>
            <span className="meta"><span>{d.sender}</span><span className={`pill ${PROCESS_LABEL[d.status]?.[1] ?? "info"}`}>{PROCESS_LABEL[d.status]?.[0] ?? d.status}</span></span>
          </button>
        ))}
        {role === "administrator" && health && <AdminSettings health={health} refresh={refreshHealth} onError={setError} />}
      </aside>
      <section className="main">
        {error && <div className="alert bad" role="alert">{error}</div>}
        {!detail ? <div className="placeholder">Select an email to see how the agent handled it.</div> : (
          <>
            {detail.document.status === "extraction_failed" || detail.document.status === "extraction_unavailable" ? (
              <button onClick={() => wrap(() => api(`/api/documents/${detail.document.id}/retry-extraction`, { method: "POST" }))}>Retry extraction</button>
            ) : null}
            <OrderView d={detail} role={role} onAct={act}
              onApprove={() => wrap(() => api(`/api/documents/${detail.document.id}/approve`, { method: "POST", role }))}
              onRetry={() => wrap(() => api(`/api/documents/${detail.document.id}/retry-delivery`, { method: "POST", role }))} />
          </>
        )}
      </section>
    </div>
  );
}

function AdminSettings({ health, refresh, onError }: { health: Health; refresh: () => void; onError: (e: string | null) => void }) {
  async function put(path: string, json: unknown) {
    try { await api(path, { method: "PUT", role: "administrator", json }); onError(null); refresh(); } catch (e) { onError((e as Error).message); }
  }
  return (
    <div className="admin">
      <h3>Administrator settings</h3>
      <label>Automation mode
        <select value={health.policy.mode} onChange={(e) => put("/api/policy", { mode: e.target.value })}>
          <option value="review_all">Review-all (default)</option>
          <option value="exception_only">Exception-only</option>
        </select>
      </label>
      <label>Rehearsal mode (TEST ADAPTER, not AI)
        <select value={health.rehearsal_mode ? "on" : "off"} onChange={(e) => put("/api/demo/rehearsal-mode", { value: e.target.value })}>
          <option value="off">Off</option><option value="on">On</option>
        </select>
      </label>
      <label>ERP simulator next call
        <select value={health.erp_failure_mode} onChange={(e) => put("/api/demo/erp-failure-mode", { value: e.target.value })}>
          <option value="none">Succeeds</option><option value="fail_next">Fails</option><option value="timeout_next">Times out after creating</option>
        </select>
      </label>
      <button className="ghost danger" onClick={async () => {
        if (!confirm("Reset the demo? All prototype data is cleared.")) return;
        try { await api("/api/demo/reset", { method: "POST", role: "administrator" }); refresh(); } catch (e) { onError((e as Error).message); }
      }}>Reset demo</button>
    </div>
  );
}
