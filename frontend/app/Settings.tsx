"use client";
// Settings: how this supplier's portal is connected and how much it does without a person. Connections, company and
// team are shown as set up by the administrator and cannot be edited here; notifications, approval mode and the
// owner of each kind of finding can. Test controls exist only in the test environment, where there is no real
// mailbox, ERP or retailer connection to produce these events.
import { useState } from "react";
import { FINDING_TITLE, SUPPLIER_OWNERS } from "../lib/domain/command-center";
import { showDate } from "../lib/domain/dates";
import { INTAKE_ADDRESS } from "../lib/intake/intake";
import { mergeReference } from "../lib/domain/onboarding";
import { partnerFor, supplierSetup, termsText } from "../lib/domain/partners";
import { stockOf } from "../lib/domain/fulfilment";
import type { Channel } from "../lib/domain/run-state";
import type { Reference } from "../lib/domain/validation";
import bundledReferenceJson from "../lib/domain/reference-data.v1.json";
import { type Health, PEOPLE, type Role } from "./api";
import { EdiSetting } from "./Portal";
import { useAgent } from "./run/RunProvider";

const bundledReference = bundledReferenceJson as unknown as Reference;
const who = (actor: string | null) => (actor ? actor.split(":")[1] ?? actor : "–");

export function SettingsView({ role, health }: { role: Role; health: Health | null }) {
  const agent = useAgent();
  const [error, setError] = useState<string | null>(null);
  const admin = role === "administrator";
  const testEnv = !!health && (health.test_reader || health.extractor_mode === "test");
  return (
    <section className="settings" aria-label="Settings">
      {error && <div className="alert bad" role="alert">{error}</div>}
      {!admin && <p className="muted small" role="note">You can read these settings. Only an administrator can change them.</p>}
      <Connections />
      <Company />
      <Team />
      <section className="setting-block" aria-labelledby="set-notify-h">
        <h3 id="set-notify-h">Notifications</h3>
        <label className="check">
          <input type="checkbox" disabled={!admin} checked={agent.state.settings.notifyOnReview !== false}
            onChange={(e) => agent.run({ type: "setNotifications", role, enabled: e.target.checked }).then(() => setError(null), (err: Error) => setError(err.message))} />
          {" "}Tell me when an order needs review
        </label>
        <p className="muted small">When on, an order that fails a check records a notification in its history and goes to the owner you choose under Who handles findings. In the test environment no email is sent.</p>
      </section>
      <section className="setting-block" aria-labelledby="set-approval-h">
        <h3 id="set-approval-h">Approval mode</h3>
        {health ? <Approval health={health} admin={admin} onError={setError} /> : <p className="placeholder">Loading…</p>}
      </section>
      <section className="setting-block" aria-labelledby="set-own-h">
        <h3 id="set-own-h">Who handles findings</h3>
        <Ownership admin={admin} onError={setError} />
      </section>
      {testEnv && admin && health && <TestControls health={health} onError={setError} />}
    </section>
  );
}

function Connections() {
  const agent = useAgent();
  const s = agent.state;
  const ref = mergeReference((s.settings.referenceData as unknown as Reference | null) ?? bundledReference, s.referenceOverlay);
  const docs: [string, string, string][] = [
    ["Purchase order", "Received", "Email with a PDF, to your order mailbox"],
    ["Order confirmation", "Sent", "X12 855 through Trading Grid"],
    ["Ship notice", "Sent", "X12 856 through Trading Grid"],
    ["Invoice", "Sent", "X12 810 through Trading Grid"],
  ];
  return (
    <section className="setting-block" aria-labelledby="set-conn-h">
      <h3 id="set-conn-h">Connections</h3>
      <p className="muted small">One connection for each retailer and document. A connection moves from test to live when Trading Grid and the retailer both activate it.</p>
      {ref.customers.map((c) => {
        const p = partnerFor(s, c.customer_id);
        return (
          <div key={c.customer_id} className="conn">
            <h4>{c.name}</h4>
            <div className="scroll"><table className="table stack-table">
              <thead><tr><th>Document</th><th>Direction</th><th>How</th><th>Status</th></tr></thead>
              <tbody>{docs.map(([d, dir, how]) => (
                <tr key={d}><td data-label="Document">{d}</td><td data-label="Direction">{dir}</td><td data-label="How">{how}</td>
                  <td data-label="Status"><span className="pill warn">Test</span></td></tr>
              ))}</tbody>
            </table></div>
            <dl className="facts">
              <div><dt>Retailer GLN</dt><dd>{p.buyerGln ?? "Not set. Confirmations are held until it is."}</dd></div>
              {c.ship_tos.map((t) => (
                <div key={t.ship_to_id}><dt>Delivery GLN for {t.ship_to_id}</dt><dd>{p.shipToGlns.find((x) => x.shipToId === t.ship_to_id)?.gln ?? "Not set"}</dd></div>
              ))}
            </dl>
          </div>
        );
      })}
      <div className="conn">
        <h4>Your ERP</h4>
        <p className="muted small">Orders are written to your ERP after approval. Prices, minimums and stock are read from it. Test environment: a simulated ERP held in this browser tab, with {stockOf(s).length} items.</p>
      </div>
    </section>
  );
}

function Company() {
  const sup = supplierSetup(useAgent().state);
  return (
    <section className="setting-block" aria-labelledby="set-co-h">
      <h3 id="set-co-h">Company</h3>
      <dl className="facts">
        <div><dt>Name</dt><dd>{sup.name}</dd></div>
        <div><dt>GLN</dt><dd>{sup.gln}</dd></div>
        <div><dt>GS1 company prefix</dt><dd>{sup.companyPrefix}</dd></div>
        <div><dt>Payment terms on invoices</dt><dd>{termsText(sup.paymentTerms)}</dd></div>
        <div><dt>Order mailbox</dt><dd className="mono">{INTAKE_ADDRESS}</dd></div>
      </dl>
      <p className="muted small">Your GLN identifies you to retailers in every document. The prefix is used to number pallet and carton labels. Fictional values.</p>
    </section>
  );
}

function Team() {
  return (
    <section className="setting-block" aria-labelledby="set-team-h">
      <h3 id="set-team-h">Team</h3>
      <div className="scroll"><table className="table stack-table">
        <thead><tr><th>Person</th><th>Role</th><th>Can</th></tr></thead>
        <tbody>
          <tr><td data-label="Person">Alex</td><td data-label="Role">Administrator</td><td data-label="Can">Change settings, switch approval mode, activate corrections, clear test data</td></tr>
          <tr><td data-label="Person">Rita</td><td data-label="Role">Reviewer</td><td data-label="Can">Decide on order exceptions, approve orders, choose how to ship, create ship notices and invoices</td></tr>
          <tr><td data-label="Person">Read-only user</td><td data-label="Role">Viewer</td><td data-label="Can">Read everything, change nothing</td></tr>
        </tbody>
      </table></div>
    </section>
  );
}

const MODE_LABEL: Record<string, string> = { review_all: "Review all", exception_only: "Automatic when checks pass" };
const ROUTES: [Channel, string][] = [["email_attachment", "Email with a PDF"], ["upload", "Added by hand"]];

/** Review all: every order waits for one approval. Automatic: orders that pass every check go to the ERP with no
 *  person; a failed check stops an order in both modes. Automatic needs an administrator and a recorded reason. */
function Approval({ health, admin, onError }: { health: Health; admin: boolean; onError: (e: string | null) => void }) {
  const agent = useAgent();
  const s = agent.state;
  const ref = mergeReference((s.settings.referenceData as unknown as Reference | null) ?? bundledReference, s.referenceOverlay);
  const [edit, setEdit] = useState<{ customerId: string | null; channel: Channel | null; mode: string; reason: string } | null>(null);
  const route = (c: string, ch: Channel) => [...s.policyHistory].reverse().find((p) => p.customerId === c && p.channel === ch);
  const save = async () => {
    if (!edit) return;
    try {
      await agent.run(edit.customerId && edit.channel
        ? { type: "setRoutePolicy", role: "administrator", customerId: edit.customerId, channel: edit.channel, mode: edit.mode as "review_all", reason: edit.reason || null }
        : { type: "setPolicy", role: "administrator", mode: edit.mode, reason: edit.reason || null });
      onError(null); setEdit(null);
    } catch (e) { onError((e as Error).message); }
  };
  const editor = (customerId: string | null, channel: Channel | null, mode: string) => (
    edit && edit.customerId === customerId && edit.channel === channel ? (
      <div className="row">
        <select aria-label={customerId ? `Approval mode for ${customerId} ${channel}` : "Default approval mode"} value={edit.mode}
          onChange={(e) => setEdit({ ...edit, mode: e.target.value })}>
          <option value="review_all">{MODE_LABEL.review_all}</option><option value="exception_only">{MODE_LABEL.exception_only}</option>
        </select>
        {edit.mode === "exception_only" && <input aria-label="Reason for automatic processing" placeholder="Reason (required)" value={edit.reason}
          onChange={(e) => setEdit({ ...edit, reason: e.target.value })} />}
        <button className="primary tiny" onClick={save}>Save</button>
        <button className="ghost tiny" onClick={() => setEdit(null)}>Cancel</button>
      </div>
    ) : admin ? <button className="ghost tiny" onClick={() => setEdit({ customerId, channel, mode, reason: "" })}>Change</button> : null
  );
  return (
    <div className="supervision">
      <dl className="facts">
        <div><dt>Review all</dt><dd>Every order waits for one approval, even when every check passes. Use this while you build trust in the checks, for example during the first month live.</dd></div>
        <div><dt>Automatic when checks pass</dt><dd>An order that passes every check goes to your ERP with no approval. A failed check still stops the order and waits for a person. Needs an administrator and a reason.</dd></div>
      </dl>
      <div className="row"><b>Default:</b> <span>{MODE_LABEL[health.policy.mode]}</span> {editor(null, null, health.policy.mode)}</div>
      <div className="scroll">
        <table className="table stack-table">
          <thead><tr><th>Retailer</th><th>Orders that arrive</th><th>Mode</th><th>Reason</th><th></th></tr></thead>
          <tbody>{ref.customers.flatMap((c) => ROUTES.map(([ch, label]) => {
            const p = route(c.customer_id, ch);
            return (
              <tr key={`${c.customer_id}:${ch}`}>
                <td data-label="Retailer">{c.name}</td><td data-label="Orders that arrive">{label}</td>
                <td data-label="Mode">{p ? MODE_LABEL[p.mode] : `${MODE_LABEL[health.policy.mode]} (default)`}</td>
                <td data-label="Reason" className="small">{p?.reason ? `${p.reason} · ${who(p.setBy)}` : "–"}</td>
                <td data-label="">{editor(c.customer_id, ch, p?.mode ?? health.policy.mode)}</td>
              </tr>
            );
          }))}</tbody>
        </table>
      </div>
    </div>
  );
}

const OWNED: [string, string][] = [["order_review", "Orders that need review"], ["stock_short", FINDING_TITLE.stock_short],
  ["erp_outcome", FINDING_TITLE.erp_outcome], ["retailer_message", FINDING_TITLE.retailer_message]];
const OWNER_LABEL: Record<string, string> = { "reviewer:rita": "Rita, order desk", "administrator:alex": "Alex, operations lead" };

/** The person each new finding of a kind is assigned to. Unset means unassigned. */
function Ownership({ admin, onError }: { admin: boolean; onError: (e: string | null) => void }) {
  const agent = useAgent();
  const own = agent.state.commandCenter?.ownership ?? {};
  return (
    <fieldset className="ownership">
      <p className="muted small">A new finding of each kind goes to this person, who sees it first in Command Center. You can reassign any finding there.</p>
      {OWNED.map(([k, label]) => (
        <label key={k}>{label}
          <select aria-label={`Owner for ${label}`} disabled={!admin} value={own[k] ?? ""} onChange={async (e) => {
            try { await agent.run({ type: "setFindingOwnership", role: "administrator", findingType: k as never, owner: e.target.value || null }); onError(null); }
            catch (err) { onError((err as Error).message); }
          }}>
            <option value="">Unassigned</option>
            {SUPPLIER_OWNERS.map((o) => <option key={o} value={o}>{OWNER_LABEL[o]}</option>)}
          </select>
        </label>
      ))}
    </fieldset>
  );
}

/** Test environment only. There is no live mailbox, ERP or retailer connection here, so these controls make the
 *  events a real connection would produce, such as an ERP that does not answer. */
function TestControls({ health, onError }: { health: Health; onError: (e: string | null) => void }) {
  const agent = useAgent();
  const s = agent.state;
  const go = async (f: () => Promise<unknown>) => { try { await f(); onError(null); } catch (e) { onError((e as Error).message); } };
  const incoming = stockOf(s).flatMap((i) => i.incoming.map((x) => ({ sku: i.sku, ...x })));
  return (
    <details className="test-controls">
      <summary>Test controls</summary>
      <p className="muted small">Only in the test environment. They stand in for a real mailbox, ERP and retailer connection, and change nothing outside this browser tab.</p>
      <label>Order reader
        <select value={health.test_reader ? "scripted" : "ai"} onChange={(e) => go(() => agent.run({ type: "setTestSetting", role: "administrator", key: "test_reader", value: e.target.value === "scripted" ? "on" : "off" }))}>
          <option value="scripted">Scripted reader (not AI)</option><option value="ai">AI reader</option>
        </select>
      </label>
      <label>Your ERP, next order
        <select value={health.erp_failure_mode} onChange={(e) => go(() => agent.run({ type: "setTestSetting", role: "administrator", key: "erp_failure_mode", value: e.target.value }))}>
          <option value="none">Accepts it</option><option value="fail_next">Rejects it</option><option value="timeout_next">Creates it, then does not answer</option>
        </select>
      </label>
      <label>Retailer connection, next document
        <EdiSetting onError={onError} />
      </label>
      {incoming.length > 0 && (
        <div className="row"><b>Your ERP receives stock:</b>
          {incoming.map((x) => (
            <button key={x.ref} className="ghost tiny" onClick={() => go(() => agent.run({ type: "receiveStock", role: "administrator", sku: x.sku, ref: x.ref }))}>
              {x.sku}: {x.quantity} due {showDate(x.expected)}</button>
          ))}
        </div>
      )}
      <button className="ghost danger" onClick={async () => {
        if (!confirm("Clear everything in this browser tab?")) return;
        await go(() => agent.clearTestData());
      }}>Clear test data</button>
    </details>
  );
}
