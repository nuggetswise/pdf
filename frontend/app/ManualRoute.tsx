"use client";
// Act 1 (D49): what this order would cost on the manual route. Every figure is computed from the order and the
// administrator's labelled assumptions; none is measured.
import { useState } from "react";
import {
  ASSUMPTION_LABELS, assumptionsOf, type ManualRisk, type ManualRouteAssumptions, manualRoute,
} from "../lib/domain/manual-route";
import { useAgent } from "./run/RunProvider";
import type { DocDetail } from "./api";

export function useManualRoute(docId: number) {
  const agent = useAgent();
  return agent.ready ? manualRoute(agent.state, docId) : null;
}

/** What the agent did with this PDF, step by step, from the run's own data; nothing here is a canned script. */
export function AgentWorkPanel({ d }: { d: DocDetail }) {
  const m = useManualRoute(d.document.id);
  const o = d.order;
  const payload = d.latest_version?.payload;
  if (!o || !payload) return null;
  const v = o.validation.order;
  const fieldsRead = [payload.header, ...payload.lines].flatMap((f) => Object.values(f)).filter((x) => x.value != null);
  const verified = fieldsRead.filter((x) => x.evidence_verified).length;
  const matched = v.lines.filter((l) => l.sku).length;
  const fromMemory = v.lines.filter((l) => l.resolved_by?.type === "memory_rule").length;
  const issues = o.validation.issues;
  const open = issues.filter((i) => i.status === "open").length;
  const delivered = o.delivery_state === "erp_created";
  return (
    <section className="agent-work" aria-label="What the Order Agent did">
      <div className="eyebrow">With the Order Agent</div>
      <h4>What the agent did with this PDF</h4>
      <ol>
        <li><b>Read the PDF{payload.extractor.is_ai ? " with AI" : " (rehearsal adapter, not AI)"}.</b> Pulled {fieldsRead.length} values from {d.pages.length} page{d.pages.length === 1 ? "" : "s"}; {verified} were found word for word in the PDF text, so you can click any value and see where it came from.</li>
        <li><b>Matched it to your records.</b> Customer {v.customer_name ?? "not recognised"}{v.customer_id ? ` (${v.customer_id})` : ""}, and {matched} of {v.lines.length} lines to products in your catalogue.</li>
        <li><b>Checked every line</b> against your price list, minimum order quantities and retired GTINs: {issues.length === 0 ? "nothing wrong." : `found ${issues.length} problem${issues.length === 1 ? "" : "s"}: ${issues.map((i) => i.title).join("; ")}.`}</li>
        {fromMemory > 0 && <li><b>Fixed {fromMemory} line{fromMemory === 1 ? "" : "s"} from memory</b>, using a correction an administrator approved on an earlier order.</li>}
        <li><b>{delivered ? "Sent it to your ERP" : open > 0 ? `Waiting on you for ${open} decision${open === 1 ? "" : "s"}` : "Ready to approve"}.</b> {delivered ? "Nothing was retyped. The ASN and invoice are pre-filled in the Trading Grid outbox." : "Once decided, it goes to your ERP by itself and the ASN and invoice are pre-filled. You retype nothing."}</li>
      </ol>
      {m && <p className="aw-sum"><b>0</b> fields typed by hand, instead of <b>{m.fields.total}</b>.</p>}
    </section>
  );
}

export function ManualRoutePanel({ docId }: { docId: number }) {
  const m = useManualRoute(docId);
  const [open, setOpen] = useState(false);
  if (!m) return null;
  const caught = m.risks.length;
  return (
    <section className="manual-route" aria-label="If you retyped this order">
      <header>
        <div>
          <div className="eyebrow">Without the Order Agent · estimate</div>
          <h4>If you retyped this order</h4>
        </div>
        <button className="ghost" onClick={() => setOpen(!open)}>{open ? "Hide the maths" : "Show the maths"}</button>
      </header>
      <div className="mr-tiles">
        <div><b>{m.fields.total}</b><span>fields to retype into the ERP and the Trading Grid web form</span></div>
        <div><b>{m.minutes} min</b><span>of keying, about {m.currency} {m.labourCost}</span></div>
        <div><b>{caught}</b><span>{caught === 1 ? "error" : "errors"} a person would likely have keyed through</span></div>
        <div className="bad"><b>{m.currency} {m.chargebackExposure}</b><span>chargeback and short-pay exposure</span></div>
      </div>
      {open && (
        <div className="mr-detail">
          <p className="calc">Fields: {m.fields.order} on the order (6 header + 4 per line), {m.fields.asn} on the ASN, {m.fields.invoice} on the invoice = <b>{m.fields.total}</b>.</p>
          <p className="calc">Time: {m.fields.total} fields × {m.secondsPerField} s = <b>{m.minutes} min</b>. Cost: {m.minutes} min × {m.currency} {m.hourlyRate} per hour = <b>{m.currency} {m.labourCost}</b>.</p>
          <table>
            <tbody>
              {m.risks.map((r, i) => (
                <tr key={i}><th>{r.label}</th><td>{r.detail}</td><td className="num">{r.amount ? `${m.currency} ${r.amount}` : "—"}</td></tr>
              ))}
              <tr><th>ASN timing</th><td>Order value {m.currency} {m.orderValue} × {m.lateAsnPenaltyPercent}% late-ASN chargeback × {m.lateAsnChancePercent}% chance a retyped ASN is late.</td>
                <td className="num">{m.currency} {m.lateAsnExposure}</td></tr>
              <tr className="total"><th>Exposure</th><td>Sum of the rows above.</td><td className="num"><b>{m.currency} {m.chargebackExposure}</b></td></tr>
            </tbody>
          </table>
          <p className="hint">The price and retired-item rows are the problems the agent actually found on this PDF. The rates (seconds per field, hourly cost, chargeback percentages) are example assumptions; change them under Settings to match the customer you are showing.</p>
        </div>
      )}
    </section>
  );
}

/** One line on an issue card: what this error costs on the manual route. */
export function IssueRiskLine({ risk, currency }: { risk: ManualRisk | undefined; currency: string }) {
  if (!risk) return null;
  return <p className="risk-line">Manual route: {risk.amount ? <b>{currency} {risk.amount} at risk.</b> : <b>no chargeback, but a loss.</b>} {risk.detail}</p>;
}

export function ManualRouteSetting({ onError }: { onError: (e: string | null) => void }) {
  const agent = useAgent();
  const current = agent.ready ? assumptionsOf(agent.state) : null;
  const [draft, setDraft] = useState<ManualRouteAssumptions | null>(null);
  if (!current) return null;
  const f = draft ?? current;
  const keys = Object.keys(ASSUMPTION_LABELS) as (keyof ManualRouteAssumptions)[];
  return (
    <form className="mr-settings" onSubmit={async (e) => {
      e.preventDefault();
      try {
        await agent.run({ type: "setManualRouteAssumptions", role: "administrator", values: f });
        setDraft(null); onError(null);
      } catch (exc) { onError((exc as Error).message); }
    }}>
      <h4>Manual route assumptions (examples)</h4>
      {keys.map((k) => (
        <label key={k}>{ASSUMPTION_LABELS[k]}
          <input inputMode="decimal" value={f[k]} onChange={(e) => setDraft({ ...f, [k]: e.target.value })} />
        </label>
      ))}
      <div className="btns"><button className="primary" type="submit" disabled={!draft}>Save assumptions</button></div>
    </form>
  );
}
