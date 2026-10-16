"use client";
import type React from "react";
import { useState } from "react";
import { showDate } from "../lib/domain/dates";
import { freeStock, fulfilmentSettings, reserved, stockOf } from "../lib/domain/fulfilment";
import { documentDetail, documentsList, erpOrdersList, rulesList } from "../lib/domain/selectors";
import { Health, Issue, PROCESS_LABEL, Role } from "./api";
import { OrderView } from "./OrderView";
import { EdiSetting } from "./Portal";
import { useAgent } from "./run/RunProvider";

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

/** D61: the supplier's ERP stock (fictional), what open orders hold, and deliveries the supplier is waiting for. */
function StockTable({ role }: { role: Role }) {
  const agent = useAgent();
  const s = agent.state;
  const [edit, setEdit] = useState<{ sku: string; onHand: string; lead: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const go = async (f: () => Promise<unknown>) => { try { await f(); setError(null); setEdit(null); } catch (e) { setError((e as Error).message); } };
  const ref = (s.settings.referenceData ?? null) as { products?: { sku: string; description?: string }[] } | null;
  const desc = (sku: string) => ref?.products?.find((p) => p.sku === sku)?.description
    ?? s.orders.flatMap((o) => o.validation.order.lines).find((l) => l.sku === sku)?.description ?? "";
  const items = stockOf(s);
  return (
    <section aria-label="Stock">
      <h3>Stock</h3>
      <p className="muted small">Stock used for order availability checks. Fictional data.</p>
      {error && <div className="alert bad" role="alert">{error}</div>}
      <div className="scroll">
        <table className="lines stock">
          <thead><tr><th>Item</th><th>On hand</th><th>Held for orders</th><th>Free</th><th>Incoming</th><th>Lead time</th><th></th></tr></thead>
          <tbody>
            {items.map((i) => {
              const held = reserved(s, i.sku, null);
              const editing = edit?.sku === i.sku;
              return (
                <tr key={i.sku}>
                  <td><b>{i.sku}</b><div className="muted small">{desc(i.sku)}</div></td>
                  <td>{editing ? <input className="qty" aria-label={`On hand ${i.sku}`} value={edit.onHand} onChange={(e) => setEdit({ ...edit, onHand: e.target.value })} /> : i.onHand}</td>
                  <td>{held.toFixedPoint()}</td>
                  <td>{freeStock(s, i.sku)?.toFixedPoint() ?? "—"}</td>
                  <td>{i.incoming.length === 0 ? "—" : i.incoming.map((x) => (
                    <div key={x.ref} className="small">{x.quantity} on {showDate(x.expected)} <span className="muted">({x.ref})</span>
                      {role !== "viewer" && <button className="ghost tiny" onClick={() => go(() => agent.run({ type: "receiveStock", role, sku: i.sku, ref: x.ref }))}>Receive</button>}</div>
                  ))}</td>
                  <td>{editing ? <input className="qty" aria-label={`Lead time ${i.sku}`} value={edit.lead} onChange={(e) => setEdit({ ...edit, lead: e.target.value })} /> : `${i.leadTimeDays} days`}</td>
                  <td>{role === "administrator" && (editing
                    ? <button className="tiny" onClick={() => go(() => agent.run({ type: "setStock", role, sku: i.sku, onHand: edit.onHand.trim(), leadTimeDays: Number(edit.lead) }))}>Save</button>
                    : <button className="ghost tiny" onClick={() => setEdit({ sku: i.sku, onHand: i.onHand, lead: String(i.leadTimeDays) })}>Edit</button>)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ErpView({ role }: { role: Role }) {
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
      {agent.ready && <StockTable role={role} />}
    </section>
  );
}

export function Workspace({ role, focus = null }: { role: Role; focus?: number | null }) {
  const agent = useAgent();
  const docs = agent.ready ? documentsList(agent.state) : null;
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
          <span className="muted small">PDF, or a forwarded email (.eml) with the PDF attached. Drop it here or click to choose. The file is read in your browser; the AI reads the PDF itself, in any layout.</span>
        </label>
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
        {!detail ? <div className="placeholder">Upload a purchase order or select one from the inbox.</div> : (
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
      <ShippingSettings onError={onError} />
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

/** D61: how ship dates are worked out, and what happens when stock is short. */
function ShippingSettings({ onError }: { onError: (e: string | null) => void }) {
  const agent = useAgent();
  const cur = fulfilmentSettings(agent.state);
  const [pack, setPack] = useState(String(cur.packDays));
  const [transit, setTransit] = useState(String(cur.transitDays));
  const [policy, setPolicy] = useState(cur.shortStock);
  const save = async () => {
    try {
      await agent.run({ type: "setFulfilmentSettings", role: "administrator",
        settings: { packDays: Number(pack), transitDays: Number(transit), shortStock: policy, retailers: cur.retailers } });
      onError(null);
    } catch (e) { onError((e as Error).message); }
  };
  return (
    <fieldset className="shipping-settings">
      <legend>Ship dates and short stock</legend>
      <label>Working days to pick and pack<input className="qty" aria-label="Packing days" value={pack} onChange={(e) => setPack(e.target.value)} /></label>
      <label>Working days in transit to the retailer<input className="qty" aria-label="Transit days" value={transit} onChange={(e) => setTransit(e.target.value)} /></label>
      <label>When stock is short
        <select aria-label="Short stock" value={policy} onChange={(e) => setPolicy(e.target.value as typeof policy)}>
          <option value="ask">Ask me each time</option>
          <option value="ship_complete">Hold and ship complete</option>
          <option value="split">Ship what is there, backorder the rest</option>
        </select>
      </label>
      <button onClick={save}>Save shipping settings</button>
      <p className="muted small">Applies to new orders.</p>
    </fieldset>
  );
}
