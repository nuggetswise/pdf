"use client";
// Act 1 (D49): what this order would cost on the manual route. Every figure is computed from the order and the
// administrator's labelled assumptions; none is measured.
import { useState } from "react";
import {
  ASSUMPTION_LABELS, assumptionsOf, type ManualRisk, type ManualRouteAssumptions, manualRoute,
} from "../lib/domain/manual-route";
import { useAgent } from "./run/RunProvider";

export function useManualRoute(docId: number) {
  const agent = useAgent();
  return agent.ready ? manualRoute(agent.state, docId) : null;
}

export function ManualRoutePanel({ docId }: { docId: number }) {
  const m = useManualRoute(docId);
  const [open, setOpen] = useState(true);
  if (!m) return null;
  const caught = m.risks.length;
  return (
    <section className="manual-route" aria-label="If you retyped this order">
      <header>
        <div>
          <div className="eyebrow">Without the Order Agent · estimate from labelled assumptions</div>
          <h4>If you retyped this order</h4>
        </div>
        <button className="ghost" onClick={() => setOpen(!open)}>{open ? "Hide" : "Show"}</button>
      </header>
      <div className="mr-tiles">
        <div><b>{m.fields.total}</b><span>fields to retype into the ERP and the Trading Grid web form</span></div>
        <div><b>{m.minutes} min</b><span>of keying, about {m.currency} {m.labourCost}</span></div>
        <div><b>{caught}</b><span>{caught === 1 ? "error" : "errors"} a person would likely have keyed through</span></div>
        <div className="bad"><b>{m.currency} {m.chargebackExposure}</b><span>chargeback and short-pay exposure</span></div>
      </div>
      {open && (
        <div className="mr-detail">
          <table>
            <tbody>
              {m.risks.map((r, i) => (
                <tr key={i}><th>{r.label}</th><td>{r.detail}</td><td className="num">{r.amount ? `${m.currency} ${r.amount}` : "—"}</td></tr>
              ))}
              <tr><th>ASN timing</th><td>A retyped ASN sometimes reaches the retailer after the freight. Expected late-ASN chargeback on a {m.currency} {m.orderValue} order.</td>
                <td className="num">{m.currency} {m.lateAsnExposure}</td></tr>
              <tr><th>Keying</th><td>Expected keying mistakes across {m.fields.total} fields ({m.fields.order} order, {m.fields.asn} ASN, {m.fields.invoice} invoice).</td>
                <td className="num">{m.expectedKeyingErrors}</td></tr>
            </tbody>
          </table>
          <p className="hint">The Order Agent read this PDF, caught the errors above before anything was sent, and fills the ASN and invoice from the approved order. Assumptions are examples an administrator can change.</p>
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
