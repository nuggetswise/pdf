"use client";
// D61: stock and ship date for one order, in the order itself. The agent checks ERP stock when the order reaches
// the ERP; a shortage waits here for a person, then the retailer is told what ships when. Below: the supplier's
// reply in their own words, and "mark shipped" once the goods leave (both moved here from Today).
import { useState } from "react";
import { CalendarClock, PackageCheck, PackageX, Truck } from "lucide-react";
import { showDate } from "../lib/domain/dates";
import { earliestShipOn, firstShipOn, stockOf } from "../lib/domain/fulfilment";
import { openQuantities, portalForOrder, repliesFor, shippable } from "../lib/domain/portal";
import type { RunState, ShipPart } from "../lib/domain/run-state";
import type { Role } from "./api";
import { ReplyBox } from "./LiveView";
import { useAgent } from "./run/RunProvider";

type Order = RunState["orders"][number];
type Choice = "ship_complete" | "split" | "ship_available";
const CHOICE_TEXT: Record<Choice, [string, string]> = {
  ship_complete: ["Hold and ship complete", "All lines ship together when stock arrives."],
  split: ["Ship now, backorder the rest", "Available stock ships now. Remaining quantity ships when stock arrives."],
  ship_available: ["Ship now, cancel the rest", "Available stock ships now. Remaining quantity is cancelled."],
};

function useWrap() {
  const [error, setError] = useState<string | null>(null);
  const wrap = async (f: () => Promise<unknown>) => {
    try { await f(); setError(null); } catch (e) { setError((e as Error).message); }
  };
  return { error, wrap };
}

const lineName = (o: Order, i: number) => {
  const l = o.validation.order.lines.find((x) => x.line_index === i);
  return l ? `${l.description ?? l.sku}` : `Line ${i + 1}`;
};
const unitOf = (o: Order, i: number) => (o.validation.order.lines.find((x) => x.line_index === i)?.unit ?? "").toLowerCase();

/** "60 ship Tue, Nov 10 · 25 backordered to Mon, Nov 23" for one line. */
export function partsText(parts: ShipPart[], lineIndex: number): string {
  return parts.filter((p) => p.lineIndex === lineIndex).map((p) => p.kind === "now" ? `${p.quantity} ship ${showDate(p.shipOn)}`
    : p.kind === "backorder" ? `${p.quantity} backordered to ${showDate(p.shipOn)}` : `${p.quantity} will not ship`).join(" · ");
}

export function FulfilmentPanel({ docId, role }: { docId: number; role: Role }) {
  const agent = useAgent();
  const s = agent.state;
  const o = s.orders.find((x) => x.documentId === docId);
  const f = o?.fulfilment;
  const { error, wrap } = useWrap();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [shipOn, setShipOn] = useState("");
  const [scac, setScac] = useState("");
  const [track, setTrack] = useState("");
  if (!o || !f) return null;
  const pick = choice ?? f.choice ?? f.recommended;
  const stock = stockOf(s);
  const p = portalForOrder(s, docId);
  const left = [...openQuantities(s, docId).values()].some((q) => !q.isZero());
  const canShip = shippable(s, docId).some((x) => !x.qty.isZero());
  const replied = repliesFor(s, docId).length > 0;
  const deciding = f.status === "needs_decision";
  const parts = deciding ? f.options[pick]?.parts ?? [] : f.parts;
  const earliest = earliestShipOn(f, pick);
  const w = f.window;
  return (
    <section className="fulfil" aria-label="Stock and ship date">
      <header className="fhead">
        <h4><PackageCheck size={18} aria-hidden /> Stock and ship date</h4>
        <span className={`pill ${deciding ? "warn" : "ok"}`}>{deciding ? "Needs your choice" : `Ships ${showDate(firstShipOn(f.parts))}`}</span>
      </header>
      <p className="muted small">Checked against ERP stock on {showDate(f.checkedOn)}. Stock reserved for open orders is excluded.</p>
      <div className="scroll">
        <table className="lines" aria-label="Stock check">
          <thead><tr><th>Item</th><th>Ordered</th><th>Free now</th><th>Short</th><th>Short stock ready</th><th>{deciding ? "Plan" : "Retailer told"}</th></tr></thead>
          <tbody>
            {f.lines.map((l) => {
              const short = l.short !== "0";
              const item = stock.find((x) => x.sku === l.sku);
              return (
                <tr key={l.lineIndex} className={short ? "short" : ""}>
                  <td>{lineName(o, l.lineIndex)}<div className="muted small">{l.sku ?? "no ERP item"}{item ? ` · ${item.onHand} on hand now` : ""}</div></td>
                  <td>{l.ordered} {unitOf(o, l.lineIndex)}</td>
                  <td>{l.availableNow}</td>
                  <td>{short ? <span className="pill warn">{l.short}</span> : "—"}</td>
                  <td>{short ? <>{showDate(l.shortReadyOn)}<div className="muted small">{l.shortSource === "incoming" ? "your incoming delivery" : "your lead time"}</div></> : "—"}</td>
                  <td className="small">{partsText(parts, l.lineIndex) || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="working" aria-label="How the ship date was worked out">
        <CalendarClock size={16} aria-hidden />
        <div>
          <b>Latest ship date {showDate(f.shipBy)}</b>
          <span className="muted small"> {[
            w.noLaterThan && `ship window ends ${showDate(w.noLaterThan)}`,
            w.deliverBy && `delivery due ${showDate(w.deliverBy)} less ${w.transitDays} working day${w.transitDays === 1 ? "" : "s"} in transit`,
          ].filter(Boolean).join("; ") || "the PO gives no dates"}. Earliest is {w.packDays} working day{w.packDays === 1 ? "" : "s"} to pick and pack after stock is free{w.notBefore ? `, not before ${showDate(w.notBefore)}` : ""}.</span>
        </div>
      </div>

      {deciding && (
        <div className="stock-decide" aria-label="Choose how to ship">
          <p><b>Stock is short.</b> Select a shipping option. The acknowledgement is held until you confirm.</p>
          <div className="choices" role="radiogroup" aria-label="Shipping choice">
            {(["ship_complete", "split", "ship_available"] as Choice[]).filter((c) => f.options[c]).map((c) => {
              const opt = f.options[c]!;
              const first = firstShipOn(opt.parts);
              const last = opt.parts.filter((x) => x.kind === "backorder").map((x) => x.shipOn).sort().at(-1);
              return (
                <label key={c} className={`choice ${pick === c ? "on" : ""}`}>
                  <input type="radio" name={`ship-${docId}`} checked={pick === c} onChange={() => { setChoice(c); setShipOn(""); }} />
                  <span><b>{CHOICE_TEXT[c][0]}</b>{f.recommended === c && <span className="pill info">Recommended</span>}
                    <span className="muted small">{CHOICE_TEXT[c][1]}</span>
                    <span className="small">{c === "split" ? `First shipment ${showDate(first)}, rest ${showDate(last)}` : `Ships ${showDate(first)}`}
                      {opt.late && <span className="pill bad">After the latest ship date</span>}</span></span>
                </label>
              );
            })}
          </div>
          {f.recommended === "ship_complete" && f.options.ship_complete.late && (
            <p className="muted small">Recommended: the PO requests complete shipments.</p>
          )}
          {role !== "viewer" && (
            <div className="btns">
              <label className="muted small">Ship date
                <input type="date" aria-label="Ship date" min={earliest ?? undefined} value={shipOn || earliest || ""} onChange={(e) => setShipOn(e.target.value)} />
              </label>
              <button className="primary" onClick={() => wrap(() => agent.run({ type: "decideFulfilment", role, docId, choice: pick,
                shipOn: shipOn && shipOn !== earliest ? shipOn : null }))}>Confirm to the retailer</button>
              <span className="muted small">Updates the ERP order and sends the acknowledgement with line-level dates.</span>
            </div>
          )}
        </div>
      )}

      {!deciding && f.decidedBy && f.decidedBy !== "system:order-agent" && (
        <p className="muted small">{CHOICE_TEXT[f.choice as Choice]?.[0]}, chosen by {f.decidedBy.split(":")[1]}.</p>
      )}

      {!deciding && !p.asn && !replied && <ReplyBox o={o} role={role} />}
      {replied && !p.asn && <p className="muted small">Your reply was confirmed to the retailer.</p>}

      {!deciding && left && role !== "viewer" && (
        <div className="ship" aria-label="Mark shipped">
          <h5><Truck size={16} aria-hidden /> Shipment</h5>
          {canShip ? (
            <div className="btns">
              <input className="qty" aria-label="Carrier SCAC" placeholder="Carrier code" value={scac} onChange={(e) => setScac(e.target.value.toUpperCase())} />
              <input aria-label="Tracking number" placeholder="Tracking number" value={track} onChange={(e) => setTrack(e.target.value)} />
              <button className="primary" disabled={!scac.trim() || !track.trim()}
                onClick={() => wrap(() => agent.run({ type: "shipFromErp", role, docId, carrierScac: scac.trim(), trackingNumber: track.trim() }))}>Mark shipped in ERP</button>
              <span className="muted small">Ships available stock. The ship notice and invoice are sent automatically.</span>
            </div>
          ) : <p className="muted small"><PackageX size={14} aria-hidden /> Nothing to ship yet. Receive incoming stock under Sent.</p>}
        </div>
      )}
      {error && <div className="alert bad" role="alert">{error}</div>}
    </section>
  );
}
