"use client";
// Supplier portal screens (D45, D47): EDI setup, order confirmation, ASN with packing, invoice with tax and
// allowances, the retailer compliance check before every send, and the EDI tab.
// Everything here is simulated: the "Retailer EDI outbox" and the supplier ERP live in this browser tab.
import { asnTiming, type AsnTiming } from "../lib/domain/asn-timing";
import { labelsFor, ssccBarcodeSvg, ssccText } from "../lib/domain/labels";
import { useMemo, useState } from "react";
import { type ComplianceResult, PROFILES, PROFILE_IDS, type ProfileId, SOURCES, type SourceId } from "../lib/domain/compliance";
import { FICTIONAL_LABEL } from "../lib/domain/gs1";
import { addWorkdays } from "../lib/domain/dates";
import { firstShipOn, retailerRules } from "../lib/domain/fulfilment";
import { Dec } from "../lib/domain/money";
import { partnerFor, supplierSetup, termsText } from "../lib/domain/partners";
import {
  ALLOWANCE_CODES, DEFAULT_SHIP_TO, type InvoiceInput, deliverySummary, draftAsn, draftInvoice, openQuantities, outboundList, portalForOrder,
} from "../lib/domain/portal";
import { type Asn, type ComplianceSummary, type OutboundMessage, decimalString } from "../lib/domain/run-state";
import { Role } from "./api";
import { useAgent } from "./run/RunProvider";

const KIND_LABEL: Record<OutboundMessage["kind"], string> = {
  ORDRSP: "Order confirmation (EDIFACT ORDRSP)", DESADV: "Shipping notice (EDIFACT DESADV)",
  INVOIC: "Invoice (EDIFACT INVOIC)", ERP_SHIPMENT: "Shipment record in supplier ERP", ERP_INVOICE: "Invoice record in supplier ERP", ERP_ORDER_CHANGE: "Backorder cancelled in supplier ERP",
};
const CHANNEL_LABEL = { retailer_edi_outbox: "Trading Grid, to the retailer (simulated)", supplier_erp: "Supplier ERP simulator" };
const STATUS_TONE = { delivered: "ok", pending: "warn", failed: "bad" } as const;

function useWrap() {
  const [error, setError] = useState<string | null>(null);
  const wrap = async (f: () => Promise<unknown>) => {
    try { await f(); setError(null); } catch (e) { setError((e as Error).message); }
  };
  return { error, wrap };
}

/** Run a draft builder; an input it cannot turn into a message comes back as the reason. */
function attempt<T>(f: () => T): { value: T | null; problem: string | null } {
  try { return { value: f(), problem: null }; } catch (e) { return { value: null, problem: (e as Error).message }; }
}

/** The retailer check: which profile, how many rules pass, and every finding with its source. */
export function ComplianceBox({ result, sent = false }: { result: ComplianceResult | ComplianceSummary; sent?: boolean }) {
  const blocks = result.findings.filter((f) => f.severity === "block");
  const warns = result.findings.filter((f) => f.severity === "warn");
  const tone = blocks.length ? "bad" : warns.length ? "warn" : "ok";
  return (
    <div className={`compliance ${tone}`} aria-label="Retailer check">
      <div>
        <span className={`pill ${tone}`}>{blocks.length ? "Would be rejected" : sent ? "Passed retailer check" : "Passes retailer check"}</span>
        {" "}<b>{PROFILES[result.profile].name}</b> · {result.rulesPassed} of {result.rulesChecked} rules pass
      </div>
      {result.findings.length > 0 && (
        <ul className="findings">
          {result.findings.map((f, i) => (
            <li key={i} className={f.severity}>
              <span className={`pill ${f.severity === "block" ? "bad" : "warn"}`}>{f.severity === "block" ? "Blocks" : "Warning"}</span> {f.text}
              <span className="muted small"> · {f.ruleId} · {f.basis === "sourced" ? "sourced: " : "inferred from the standard"}
                {f.sources.map((s, j) => {
                  const src = SOURCES[s as SourceId];
                  return src ? <span key={s}>{j ? ", " : ""}<a href={src.url} target="_blank" rel="noreferrer">{src.title}</a></span> : null;
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
      {blocks.length > 0 && <p className="muted small">Nothing is sent while a rule blocks. Fix the cause above, then submit.</p>}
    </div>
  );
}

const X12_KIND: Partial<Record<OutboundMessage["kind"], string>> = {
  ORDRSP: "Order acknowledgement (X12 855)", DESADV: "Ship notice (X12 856)", INVOIC: "Invoice (X12 810)",
};
const msgLabel = (m: OutboundMessage) => (m.format === "x12" ? X12_KIND[m.kind] : undefined) ?? KIND_LABEL[m.kind];

function MessageRow({ m, role }: { m: OutboundMessage; role: Role }) {
  const agent = useAgent();
  const { error, wrap } = useWrap();
  const held = m.status === "pending" && m.attempts.at(-1)?.outcome === "held";
  return (
    <li className={`outmsg ${m.status}`}>
      <span className={`pill ${held ? "bad" : STATUS_TONE[m.status]}`}>{held ? "Held" : m.status === "delivered" ? "Delivered" : m.status === "pending" ? "Pending" : "Failed"}</span>
      <span> {msgLabel(m)} → {CHANNEL_LABEL[m.channel]}{m.receiverRef ? ` as ${m.receiverRef}` : ""}</span>
      <div className="muted small">{m.attempts.at(-1)?.detail} · key <span className="mono">{m.idempotencyKey}</span></div>
      {m.compliance && !held && m.compliance.findings.length > 0 && (
        <div className="muted small">{m.compliance.findings.length} warning{m.compliance.findings.length === 1 ? "" : "s"} from the retailer check: {m.compliance.findings[0].text}</div>
      )}
      {m.status !== "delivered" && role !== "viewer" && (
        <button className="ghost" onClick={() => wrap(() => agent.run({ type: "retryOutbound", role, messageId: m.id }))}>
          {held ? "Check again and send" : "Check receiver and retry safely"}
        </button>
      )}
      {error && <div className="alert bad" role="alert">{error}</div>}
    </li>
  );
}

/** Shown on a delivered order: EDI setup, the confirmation, then Create ASN, then Create invoice. */
export function OrderPortal({ docId, role }: { docId: number; role: Role }) {
  const agent = useAgent();
  const p = portalForOrder(agent.state, docId);
  const order = agent.state.orders.find((o) => o.documentId === docId);
  const [asnOpen, setAsnOpen] = useState(false);
  if (!order) return null;
  return (
    <section className="portal" aria-label="Supplier portal">
      <div className="eyebrow">Trading Grid web form, pre-filled by the Order Agent (simulated) · nothing is sent to a real retailer</div>
      <EdiSetup docId={docId} role={role} />
      {p.confirmation && (
        <div className="flow" aria-label="Order confirmation">
          <h4>Order confirmation to retailer</h4>
          <ul className="outlist"><MessageRow m={p.confirmation} role={role} /></ul>
        </div>
      )}
      {p.shipments.map((sh, n) => (
        <Shipment key={sh.asn.id} n={n} sh={sh} docId={docId} role={role} po={order.validation.order.po_number}
          requested={order.validation.order.requested_delivery_date} />
      ))}
      {p.shipments.length === 0 ? (
        <div className="flow" aria-label="Shipping notice">
          <h4>Shipping notice (ASN)</h4>
          {order.fulfilment?.status === "needs_decision" ? <p className="muted small">Select a shipping option in Stock and ship date to create the ASN.</p>
            : asnOpen ? <AsnForm docId={docId} role={role} onDone={() => setAsnOpen(false)} />
            : role !== "viewer" ? <button className="primary" onClick={() => setAsnOpen(true)}>Create ASN</button>
            : <p className="muted small">No ASN yet.</p>}
        </div>
      ) : <Backorder docId={docId} role={role} />}
    </section>
  );
}

type ShipmentView = ReturnType<typeof portalForOrder>["shipments"][number];

/** One ASN and its invoice (D52: an order can ship in several parts, each with its own invoice). */
function Shipment({ n, sh, docId, role, po, requested }: { n: number; sh: ShipmentView; docId: number; role: Role; po: string | null;
  requested: string | null }) {
  const [invOpen, setInvOpen] = useState(false);
  const { asn, asnMessages, invoice, invoiceMessages } = sh;
  const desadv = asnMessages.find((m) => m.kind === "DESADV");
  const invoic = invoiceMessages.find((m) => m.kind === "INVOIC");
  const suffix = n === 0 ? "" : ` ${n + 1}`;
  return (
    <>
      <div className="flow" aria-label={`Shipping notice${suffix}`}>
        <h4>Shipping notice (ASN): {asn.asnNumber}{n > 0 && <span className="muted small"> · shipment {n + 1}</span>}</h4>
        <p className="flowstate"><b>{deliverySummary(asnMessages)}</b></p>
        <p className="muted small">Shipped {asn.lines.filter((l) => !Dec.of(l.shippedQty).isZero()).map((l) => `${l.shippedQty} ${l.unit} line ${l.sourceLineId}`).join(", ")}</p>
        {asn.pallets && (
          <p className="muted small" aria-label={`Packing${suffix}`}>
            {asn.pallets.length} pallet{asn.pallets.length === 1 ? "" : "s"}, {asn.pallets.reduce((t, x) => t + x.cartons.length, 0)} cartons ·
            estimated delivery {asn.estimatedDelivery ?? "none"} · pallet SSCC {asn.pallets.map((x) => x.sscc).join(", ")}
          </p>
        )}
        {(asn.carrierScac || asn.bolNumber || asn.trackingNumber) && (
          <p className="muted small" aria-label={`Carrier${suffix}`}>Carrier {asn.carrierScac ?? "not given"}{asn.bolNumber ? ` · BOL ${asn.bolNumber}` : ""}{asn.trackingNumber ? ` · PRO ${asn.trackingNumber}` : ""}</p>
        )}
        <TimingBox timing={asnTiming({ requestedDelivery: requested, shipDate: asn.despatchDate, estimatedDelivery: asn.estimatedDelivery,
          sentOn: asn.createdAt.slice(0, 10) })} />
        {asn.pallets && <LabelsButton asn={asn} po={po} />}
        {desadv?.compliance && <ComplianceBox result={desadv.compliance} sent />}
        <ul className="outlist">{asnMessages.map((m) => <MessageRow key={m.id} m={m} role={role} />)}</ul>
      </div>
      <div className="flow" aria-label={`Invoice${suffix}`}>
        <h4>Invoice{invoice && `: ${invoice.invoiceNumber}`}{!invoice && ` for ${asn.asnNumber}`}</h4>
        {invoice ? (
          <>
            <p className="flowstate"><b>{deliverySummary(invoiceMessages)}</b> · total <b>{invoice.total} {invoice.currency}</b>
              {invoice.taxAmount && <span className="muted small"> (lines {invoice.subtotal}, tax {invoice.taxAmount})</span>}</p>
            {invoice.terms && <p className="muted small" aria-label={`Payment terms${suffix}`}>Terms {termsText(invoice.terms)} · due {invoice.dueDate}</p>}
            {invoic?.compliance && <ComplianceBox result={invoic.compliance} sent />}
            <ul className="outlist">{invoiceMessages.map((m) => <MessageRow key={m.id} m={m} role={role} />)}</ul>
          </>
        ) : invOpen ? (
          <InvoiceForm docId={docId} asnId={asn.id} role={role} onDone={() => setInvOpen(false)} />
        ) : role !== "viewer" ? (
          <button className="primary" onClick={() => setInvOpen(true)}>Create invoice{n > 0 ? ` for ${asn.asnNumber}` : ""}</button>
        ) : <p className="muted small">No invoice yet.</p>}
      </div>
    </>
  );
}

/** D52: what is still open after a short shipment: ship it later, or cancel it. */
function Backorder({ docId, role }: { docId: number; role: Role }) {
  const agent = useAgent();
  const order = agent.state.orders.find((o) => o.documentId === docId)!;
  const open = openQuantities(agent.state, docId);
  const p = portalForOrder(agent.state, docId);
  const [mode, setMode] = useState<"none" | "asn" | "cancel">("none");
  const [why, setWhy] = useState("");
  const { error, wrap } = useWrap();
  const lines = order.validation.order.lines.filter((l) => Dec.ZERO.lt(open.get(l.line_index) ?? Dec.ZERO));
  if (!lines.length) {
    return p.cancelled.length ? (
      <div className="flow" aria-label="Backorder"><h4>Backorder</h4>
        <p className="muted small">Rest of the order cancelled: {p.cancelled.map((c) => {
          const l = order.validation.order.lines.find((x) => x.line_index === c.lineIndex);
          return `${c.quantity} ${l?.unit ?? ""} line ${l?.source_line_id ?? c.lineIndex}`;
        }).join(", ")} ({p.cancelled[0].reason}).</p></div>
    ) : null;
  }
  return (
    <div className="flow" aria-label="Backorder">
      <h4>Backorder: still to ship</h4>
      <p className="small">{lines.map((l) => `${open.get(l.line_index)!.toFixedPoint()} ${l.unit} line ${l.source_line_id}`).join(", ")}</p>
      {mode === "asn" ? <AsnForm docId={docId} role={role} onDone={() => setMode("none")} />
        : mode === "cancel" ? (
          <form className="portal-form" onSubmit={(e) => { e.preventDefault(); void wrap(async () => {
            await agent.run({ type: "cancelBackorder", role, docId, reason: why }); setMode("none"); }); }}>
            <label>Reason the rest will not ship<input aria-label="Cancel reason" value={why} onChange={(e) => setWhy(e.target.value)}
              placeholder="e.g. item discontinued" /></label>
            {error && <div className="alert bad" role="alert">{error}</div>}
            <div className="btns"><button className="primary" type="submit" disabled={!why.trim()}>Cancel the rest</button>
              <button className="ghost" type="button" onClick={() => setMode("none")}>Back</button></div>
          </form>
        ) : role !== "viewer" ? (
          <div className="btns">
            <button className="primary" onClick={() => setMode("asn")}>Ship the rest (next ASN)</button>
            <button className="ghost" onClick={() => setMode("cancel")}>Cancel the rest</button>
          </div>
        ) : null}
    </div>
  );
}

/** The supplier's and this retailer's EDI identity. Real retailers start empty, so their EDI is blocked until filled. */
function EdiSetup({ docId, role }: { docId: number; role: Role }) {
  const agent = useAgent();
  const order = agent.state.orders.find((o) => o.documentId === docId)!;
  const ord = order.validation.order;
  const sup = supplierSetup(agent.state);
  const partner = partnerFor(agent.state, ord.customer_id);
  const shipKey = ord.ship_to_id ?? DEFAULT_SHIP_TO;
  const needsSetup = !partner.fictional && partner.isDefault;
  const [open, setOpen] = useState(needsSetup);
  const [f, setF] = useState(() => ({
    supplierName: sup.name ?? "", supplierGln: sup.gln, supplierVat: sup.vatId ?? "", prefix: sup.companyPrefix,
    taxType: sup.taxType, defaultTaxRate: sup.defaultTaxRate ?? "",
    discPct: sup.paymentTerms?.discountPercent ?? "", discDays: String(sup.paymentTerms?.discountDays ?? ""),
    netDays: String(sup.paymentTerms?.netDays ?? "30"),
    profile: partner.profile, buyerGln: partner.buyerGln ?? "", buyerVat: partner.buyerVatId ?? "",
    contractRef: partner.contractRef ?? "", vendorNumber: partner.vendorNumber ?? "", shipToGln: partner.shipToGlns.find((t) => t.shipToId === shipKey)?.gln ?? "",
  }));
  const { error, wrap } = useWrap();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const profiles = PROFILE_IDS;
  // US X12 retailers need no VAT numbers or EDI agreement reference; those fields stay for the EANCOM profiles.
  const x12 = f.profile === "x12_retail";
  return (
    <div className="flow edi-setup" aria-label="EDI setup">
      <h4>
        EDI setup for {ord.customer_name ?? ord.customer_id}: {PROFILES[partner.profile].name}
        {" "}<button className="ghost" onClick={() => setOpen(!open)}>{open ? "Hide" : "Edit"}</button>
      </h4>
      {(sup.fictional || partner.fictional) && <p className="muted small">{FICTIONAL_LABEL}.</p>}
      {needsSetup && <p className="alert warn" role="status">This retailer has no GLNs on file, so its EDI is held. Enter the buyer and delivery GLNs from its EDI onboarding pack.</p>}
      {open && (
        <form className="portal-form setup-grid" onSubmit={(e) => {
          e.preventDefault();
          if (role === "viewer") return;
          void wrap(async () => {
            await agent.run({ type: "saveSupplierSetup", role, name: f.supplierName || null, gln: f.supplierGln,
              vatId: x12 ? sup.vatId : f.supplierVat || null, companyPrefix: f.prefix, taxType: x12 ? "SALES" : f.taxType, defaultTaxRate: f.defaultTaxRate || null,
              paymentTerms: /^\d+$/.test(f.netDays) ? { netDays: Number(f.netDays), discountPercent: f.discPct || null,
                discountDays: /^\d+$/.test(f.discDays) ? Number(f.discDays) : null } : null });
            await agent.run({ type: "saveTradingPartner", role, customerId: ord.customer_id ?? "", profile: f.profile,
              buyerGln: f.buyerGln || null, buyerVatId: x12 ? partner.buyerVatId : f.buyerVat || null, contractRef: x12 ? partner.contractRef : f.contractRef || null,
              vendorNumber: f.vendorNumber || null,
              shipToGlns: [...partner.shipToGlns.filter((t) => t.shipToId !== shipKey),
                ...(f.shipToGln ? [{ shipToId: shipKey, gln: f.shipToGln }] : [])] });
            setOpen(false);
          });
        }}>
          <fieldset><legend>Your company (supplier)</legend>
            <label>Name<input value={f.supplierName} onChange={set("supplierName")} /></label>
            <label>Supplier GLN<input value={f.supplierGln} onChange={set("supplierGln")} inputMode="numeric" /></label>
            {!x12 && <label>Supplier VAT number<input value={f.supplierVat} onChange={set("supplierVat")} /></label>}
            <label>GS1 company prefix (for SSCCs)<input value={f.prefix} onChange={set("prefix")} inputMode="numeric" /></label>
            {!x12 && <label>Tax type<select value={f.taxType} onChange={set("taxType")}><option>VAT</option><option>GST</option><option value="SALES">Sales tax</option></select></label>}
            <label>Early payment discount %<input value={f.discPct} onChange={set("discPct")} inputMode="decimal" placeholder="e.g. 2" /></label>
            <label>if paid within (days)<input value={f.discDays} onChange={set("discDays")} inputMode="numeric" placeholder="e.g. 10" /></label>
            <label>Net days (payment due)<input value={f.netDays} onChange={set("netDays")} inputMode="numeric" /></label>
            <label>{x12 ? "Default sales tax %" : "Default tax rate %"}<input value={f.defaultTaxRate} onChange={set("defaultTaxRate")} inputMode="decimal" /></label>
          </fieldset>
          <fieldset><legend>Retailer {ord.customer_id}</legend>
            <label>Retailer rules<select value={f.profile} onChange={set("profile")}>
              {profiles.map((id) => <option key={id} value={id}>{PROFILES[id as ProfileId].name}</option>)}
            </select></label>
            <label>Buyer GLN<input value={f.buyerGln} onChange={set("buyerGln")} inputMode="numeric" /></label>
            {!x12 && <label>Buyer VAT number<input value={f.buyerVat} onChange={set("buyerVat")} /></label>}
            <label>Your vendor number at this retailer (optional)<input value={f.vendorNumber} onChange={set("vendorNumber")} /></label>
            <label>Delivery GLN for {ord.ship_to_id ?? "this PO (no ship-to printed)"}<input value={f.shipToGln} onChange={set("shipToGln")} inputMode="numeric" /></label>
            {!x12 && <label>EDI agreement / contract reference<input value={f.contractRef} onChange={set("contractRef")} /></label>}
          </fieldset>
          <p className="muted small">{PROFILES[f.profile as ProfileId].summary}</p>
          {error && <div className="alert bad" role="alert">{error}</div>}
          {role !== "viewer" && <div className="btns"><button className="primary" type="submit">Save EDI setup</button></div>}
        </form>
      )}
    </div>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

function AsnForm({ docId, role, onDone }: { docId: number; role: Role; onDone: () => void }) {
  const agent = useAgent();
  const order = agent.state.orders.find((o) => o.documentId === docId)!;
  const lines = order.validation.order.lines;
  const requested = order.validation.order.requested_delivery_date ?? "";
  const open = openQuantities(agent.state, docId);
  // First shipment: start from the stock check's "ships now" quantities and date. Later shipments: the open quantity.
  const f = order.fulfilment;
  const first = portalForOrder(agent.state, docId).shipments.length === 0;
  const nowQty = (i: number) => f?.parts.filter((x) => x.kind === "now" && x.lineIndex === i).reduce((t, x) => t.add(Dec.of(x.quantity)), Dec.ZERO);
  const startQty = (i: number, fallback: string) => {
    const o = open.get(i);
    const n = first && f ? nowQty(i) : undefined;
    if (n && o) return (n.lt(o) ? n : o).toFixedPoint();
    return o?.toFixedPoint() ?? fallback;
  };
  const plannedShip = first && f ? firstShipOn(f.parts) : null;
  const transit = retailerRules(agent.state, order.validation.order.customer_id).transitDays;
  const [qty, setQty] = useState<Record<number, string>>(Object.fromEntries(lines.map((l) => [l.line_index, startQty(l.line_index, l.quantity ?? "0")])));
  const [why, setWhy] = useState<Record<number, string>>({});
  const [perCarton, setPerCarton] = useState<Record<number, string>>({});
  const [perPallet, setPerPallet] = useState("");
  const [despatch, setDespatch] = useState(plannedShip ?? today());
  const [scac, setScac] = useState("");
  const [bol, setBol] = useState("");
  const [pro, setPro] = useState("");
  const [eta, setEta] = useState(plannedShip ? addWorkdays(plannedShip, transit) : /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : "");
  const { error, wrap } = useWrap();
  const over = (i: number, ordered: string | null) =>
    decimalString.safeParse(qty[i]).success && ordered !== null && Dec.of(ordered).lt(Dec.of(qty[i]));
  const input = {
    lines: lines.map((l) => ({ lineIndex: l.line_index, shippedQty: qty[l.line_index].trim(), overrideReason: why[l.line_index]?.trim() || null })),
    despatchDate: despatch || null, estimatedDelivery: eta || null,
    carrierScac: scac || null, bolNumber: bol || null, trackingNumber: pro || null,
    packing: { cartonsPerPallet: /^\d+$/.test(perPallet) ? Number.parseInt(perPallet, 10) : null,
      unitsPerCarton: Object.entries(perCarton).filter(([, u]) => u.trim()).map(([i, units]) => ({ lineIndex: Number.parseInt(i, 10), units })) },
  };
  const draft = useMemo(() => attempt(() => draftAsn(agent.state, docId, input, "preview", new Date().toISOString())),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agent.state, docId, JSON.stringify(input)]);
  const blocked = !draft.value || draft.value.compliance.findings.some((f) => f.severity === "block");
  const pallets = draft.value?.asn.pallets ?? [];
  const timing = asnTiming({ requestedDelivery: requested, shipDate: despatch, estimatedDelivery: eta, sentOn: today() });
  return (
    <form className="portal-form" onSubmit={(e) => {
      e.preventDefault();
      void wrap(async () => { await agent.run({ type: "submitAsn", role, docId, ...input }); onDone(); });
    }}>
      <p className="muted small">{plannedShip ? "Quantities and dates come from the stock check. Edit them to match what ships." : "Enter what ships and how it is packed."} Shipping more than ordered requires a reason.</p>
      <div className="row-inline">
        <label>Despatch date<input type="date" aria-label="Despatch date" value={despatch} onChange={(e) => setDespatch(e.target.value)} /></label>
        <label>Estimated delivery<input type="date" aria-label="Estimated delivery date" value={eta} onChange={(e) => setEta(e.target.value)} /></label>
        <label>Carrier SCAC<input className="qty" aria-label="Carrier SCAC" placeholder="e.g. UPSN" value={scac} onChange={(e) => setScac(e.target.value)} /></label>
        <label>Bill of lading<input aria-label="Bill of lading number" value={bol} onChange={(e) => setBol(e.target.value)} /></label>
        <label>Tracking (PRO) number<input aria-label="Tracking number" value={pro} onChange={(e) => setPro(e.target.value)} /></label>
        <label>Cartons per pallet<input className="qty" inputMode="numeric" aria-label="Cartons per pallet" placeholder="all on one" value={perPallet} onChange={(e) => setPerPallet(e.target.value)} /></label>
      </div>
      <table className="lines">
        <thead><tr><th>Line</th><th>Item</th><th>Ordered</th><th>Shipped</th><th>Units per carton</th></tr></thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.line_index}>
              <td>{l.source_line_id}</td>
              <td>{l.description}<div className="muted small">{l.sku} · GTIN {l.gtin ?? "none"}</div></td>
              <td>{l.quantity} {l.unit}</td>
              <td>
                <input className="qty" inputMode="decimal" aria-label={`Shipped quantity line ${l.source_line_id}`}
                  value={qty[l.line_index]} onChange={(e) => setQty({ ...qty, [l.line_index]: e.target.value })} />
                {over(l.line_index, l.quantity) && (
                  <input aria-label={`Override reason line ${l.source_line_id}`} placeholder="Reason for shipping more than ordered"
                    value={why[l.line_index] ?? ""} onChange={(e) => setWhy({ ...why, [l.line_index]: e.target.value })} />
                )}
              </td>
              <td><input className="qty" inputMode="numeric" aria-label={`Units per carton line ${l.source_line_id}`} placeholder="all"
                value={perCarton[l.line_index] ?? ""} onChange={(e) => setPerCarton({ ...perCarton, [l.line_index]: e.target.value })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <TimingBox timing={timing} />
      {draft.problem && <div className="alert warn" role="status">{draft.problem}</div>}
      {draft.value && (
        <>
          <p className="muted small" aria-label="Packing preview">
            Packing: {pallets.length} pallet{pallets.length === 1 ? "" : "s"}, {pallets.reduce((t, p) => t + p.cartons.length, 0)} carton
            {pallets.reduce((t, p) => t + p.cartons.length, 0) === 1 ? "" : "s"}, each with its own SSCC (numbered when you submit).
          </p>
          <ComplianceBox result={draft.value.compliance} />
        </>
      )}
      {error && <div className="alert bad" role="alert">{error}</div>}
      <div className="btns">
        <button className="primary" type="submit" disabled={blocked}>Submit ASN</button>
        <button className="ghost" type="button" onClick={onDone}>Cancel</button>
      </div>
      <p className="muted small">Submit sends the ship notice to the retailer through Trading Grid and records the shipment in the ERP simulator. No second step.</p>
    </form>
  );
}

/** The ASN clock (D51): sent before the freight leaves, arriving by the PO date. */
function TimingBox({ timing }: { timing: AsnTiming }) {
  return (
    <div className={`timing ${timing.onTime ? (timing.checks.length ? "warn" : "ok") : "bad"}`} aria-label="ASN timing">
      <b>{timing.onTime ? (timing.checks.length ? "ASN timing: check" : "ASN timing: on time") : "ASN timing: late"}</b>
      {timing.deliverBy && <span> · PO delivery date {timing.deliverBy}</span>}
      {timing.checks.map((c) => <p key={c.key} className="small">{c.text}</p>)}
    </div>
  );
}

/** GS1-128 carton and pallet labels for printing (D51). Opens a print-ready page; nothing leaves the browser. */
function LabelsButton({ asn, po }: { asn: Asn; po: string | null }) {
  const agent = useAgent();
  const open = () => {
    const sup = supplierSetup(agent.state);
    const esc = (v: string | null | undefined) => (v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
    const body = labelsFor(agent.state, asn).map((l) => `<section class="label"><div class="row"><b>FROM</b> ${esc(sup.name)}<br>GLN ${esc(sup.gln)}</div>
      <div class="row"><b>PO</b> ${esc(po)} · <b>ASN</b> ${esc(asn.asnNumber)}${asn.carrierScac ? ` · <b>CARRIER</b> ${esc(asn.carrierScac)}` : ""}${asn.bolNumber ? ` · <b>BOL</b> ${esc(asn.bolNumber)}` : ""}</div>
      <div class="row"><b>${l.kind === "pallet" ? "PALLET" : "CARTON"}</b> ${esc(l.index)}</div>
      <div class="row small">${l.contents.map((c) => `${esc(c.quantity)} ${esc(c.unit)} ${esc(c.sku)} GTIN ${esc(c.gtin)}`).join("<br>")}</div>
      <div class="bc">${ssccBarcodeSvg(l.sscc)}</div><div class="hr">${esc(ssccText(l.sscc))}</div>
      <div class="note">FICTIONAL DEMO LABEL · not for real shipments</div></section>`).join("");
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<!doctype html><meta charset="utf-8"><title>Labels ${esc(asn.asnNumber)}</title><style>
      body{font:12px system-ui,sans-serif;margin:0}.label{width:4in;height:6in;box-sizing:border-box;border:1px solid #000;padding:.15in;margin:.1in;display:inline-flex;flex-direction:column;gap:6px;page-break-after:always}
      .row{border-bottom:1px solid #000;padding-bottom:4px}.small{font-size:10px}.bc svg{width:100%;height:1.3in}.hr{text-align:center;font:600 14px monospace}.note{margin-top:auto;font-size:9px;text-align:center}
      @media print{.label{margin:0;border:none}}</style>${body}`);
    w.document.close();
  };
  const n = (asn.pallets ?? []).reduce((t, p) => t + 1 + p.cartons.length, 0);
  return <button className="ghost" type="button" onClick={open}>Print {n} GS1-128 label{n === 1 ? "" : "s"}</button>;
}

type AlcRow = { kind: "allowance" | "charge"; code: string; percent: string; amount: string; taxRate: string };

function InvoiceForm({ docId, asnId, role, onDone }: { docId: number; asnId: number; role: Role; onDone: () => void }) {
  const agent = useAgent();
  const p = portalForOrder(agent.state, docId);
  const order = agent.state.orders.find((o) => o.documentId === docId)!;
  const sup = supplierSetup(agent.state);
  const asn = p.shipments.find((x) => x.asn.id === asnId)!.asn;
  const shipped = asn.lines.filter((l) => !Dec.of(l.shippedQty).isZero());
  const [rates, setRates] = useState<Record<number, string>>(Object.fromEntries(shipped.map((l) => [l.lineIndex, sup.defaultTaxRate ?? ""])));
  const [alc, setAlc] = useState<AlcRow[]>([]);
  const { error, wrap } = useWrap();
  const input: InvoiceInput = {
    lines: shipped.map((l) => ({ lineIndex: l.lineIndex, quantity: l.shippedQty, taxRate: rates[l.lineIndex] ?? null })),
    allowances: alc.map((a) => ({ kind: a.kind, code: a.code, percent: a.percent || null, amount: a.amount || null, taxRate: a.taxRate })),
  };
  const draft = useMemo(() => attempt(() => draftInvoice(agent.state, asn.id, input, "preview", new Date().toISOString())),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agent.state, asn.id, JSON.stringify(input)]);
  const d = draft.value;
  const mismatch = d?.match.some((m) => m.status === "mismatch") ?? false;
  const blocked = !d || mismatch || d.compliance.findings.some((f) => f.severity === "block");
  const cur = order.validation.order.currency;
  const lineRates = [...new Set(Object.values(rates).filter((r) => r.trim()))];
  const setRow = (i: number, patch: Partial<AlcRow>) => setAlc(alc.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  return (
    <form className="portal-form" onSubmit={(e) => {
      e.preventDefault();
      void wrap(async () => { await agent.run({ type: "submitInvoice", role, asnId: asn.id, lines: input.lines, allowances: input.allowances }); onDone(); });
    }}>
      <p className="muted small">Quantities come from {asn.asnNumber} (what shipped), prices from the order. Exact decimals; tax per rate rounded half-up to cents.</p>
      <table className="lines" aria-label="Three-way match">
        <thead><tr><th>Line</th><th>Item</th><th>PO qty</th><th>ASN qty</th><th>Invoice qty</th><th>Price</th><th>Amount</th><th>{sup.taxType === "SALES" ? "Sales tax" : sup.taxType} %</th><th>Match</th></tr></thead>
        <tbody>
          {shipped.map((l) => {
            const m = d?.match.find((x) => x.sourceLineId === l.sourceLineId);
            const line = d?.invoice.lines.find((x) => x.lineIndex === l.lineIndex);
            return (
              <tr key={l.lineIndex}>
                <td>{l.sourceLineId}</td><td>{l.description}</td><td>{l.orderedQty}</td><td>{l.shippedQty}</td>
                <td><b>{l.shippedQty}</b> {l.unit}</td><td>{line?.unitPrice}</td><td>{line?.lineAmount}</td>
                <td><input className="qty" inputMode="decimal" aria-label={`Tax rate line ${l.sourceLineId}`} value={rates[l.lineIndex] ?? ""}
                  onChange={(e) => setRates({ ...rates, [l.lineIndex]: e.target.value })} /></td>
                <td><span className={`pill ${m?.status === "mismatch" ? "bad" : m?.status === "matched" ? "ok" : "warn"}`} title={m?.note}>
                  {m ? m.status.replace("_", " ") : "?"}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="allowances" aria-label="Allowances and charges">
        <b>Allowances and charges</b>
        {alc.map((a, i) => (
          <div key={i} className="row-inline">
            <select aria-label={`Allowance ${i + 1} type`} value={`${a.kind}:${a.code}`} onChange={(e) => {
              const [kind, code] = e.target.value.split(":") as [AlcRow["kind"], string];
              setRow(i, { kind, code });
            }}>
              {(Object.keys(ALLOWANCE_CODES) as AlcRow["kind"][]).flatMap((k) => Object.entries(ALLOWANCE_CODES[k]).map(([code, label]) =>
                <option key={`${k}:${code}`} value={`${k}:${code}`}>{k === "allowance" ? "Allowance" : "Charge"}: {label} ({code})</option>))}
            </select>
            <input className="qty" aria-label={`Allowance ${i + 1} percent`} placeholder="%" value={a.percent} onChange={(e) => setRow(i, { percent: e.target.value, amount: "" })} />
            <input className="qty" aria-label={`Allowance ${i + 1} amount`} placeholder={`or ${cur}`} value={a.amount} onChange={(e) => setRow(i, { amount: e.target.value, percent: "" })} />
            <select aria-label={`Allowance ${i + 1} tax rate`} value={a.taxRate} onChange={(e) => setRow(i, { taxRate: e.target.value })}>
              {lineRates.map((r) => <option key={r} value={r}>{sup.taxType === "SALES" ? "Sales tax" : sup.taxType} {r}%</option>)}
            </select>
            <button type="button" className="ghost" onClick={() => setAlc(alc.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        <button type="button" className="ghost" onClick={() => setAlc([...alc, { kind: "allowance", code: "DI", percent: "", amount: "", taxRate: lineRates[0] ?? "" }])}>
          Add allowance or charge</button>
      </div>
      {draft.problem && <div className="alert warn" role="status">{draft.problem}</div>}
      {d && (
        <div className="totals" aria-label="Amounts">
          <span>Lines <b>{d.totals.lineTotal}</b></span>
          <span>Taxable <b>{d.totals.taxableAmount}</b></span>
          {d.totals.byRate.map((r) => <span key={r.rate}>{sup.taxType === "SALES" ? "Sales tax" : sup.taxType} {r.rate}% on {r.taxable}: <b>{r.tax}</b></span>)}
          <span>Invoice total <b className="invtotal">{d.totals.invoiceAmount} {cur}</b></span>
        </div>
      )}
      {d && <ComplianceBox result={d.compliance} />}
      {mismatch && <div className="alert bad" role="alert">The invoice does not match the order and ASN; see the Match column.</div>}
      {error && <div className="alert bad" role="alert">{error}</div>}
      <div className="btns">
        <button className="primary" type="submit" disabled={blocked}>Submit invoice</button>
        <button className="ghost" type="button" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

/** The EDI tab: every outbound message, raw EDIFACT, what each segment means, the retailer check, and a download. */
export function EdiView({ role }: { role: Role }) {
  const agent = useAgent();
  const msgs = agent.ready ? outboundList(agent.state) : [];
  const [open, setOpen] = useState<number | null>(null);
  const { error, wrap } = useWrap();
  const download = (m: OutboundMessage) => {
    const ext = m.format === "edifact" ? "edi" : m.format === "x12" ? "x12" : "json";
    const blob = new Blob([m.body], { type: m.format === "edifact" ? "application/edifact" : m.format === "x12" ? "application/edi-x12" : "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${m.kind}-${m.sourceId}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section className="edi-list" aria-label="Outbound messages">
      <div className="eyebrow">Simulated EDI and ERP messages · held in this browser tab · nothing is sent anywhere real</div>
      <h3>{msgs.length} outbound message{msgs.length === 1 ? "" : "s"}</h3>
      <p className="muted small">US retailers get ANSI X12 004010 (855, 856, 810); EANCOM 2002 (UN/EDIFACT D.01B) stays available per retailer. Demo customers use {FICTIONAL_LABEL}. Every message is checked against the retailer's rules before it is sent.</p>
      {error && <div className="alert bad" role="alert">{error}</div>}
      {msgs.length === 0 && <p className="placeholder">Nothing yet. A delivered order sends an order confirmation; ASNs and invoices add more.</p>}
      {msgs.map((m) => (
        <article key={m.id} className={`edi-card ${m.status}`} data-kind={m.kind}>
          <header>
            <h4>{msgLabel(m)} · {m.sourceId}</h4>
            <span className={`pill ${STATUS_TONE[m.status]}`}>{m.status}</span>
          </header>
          <p className="muted small">To {CHANNEL_LABEL[m.channel]}{m.receiverRef ? ` as ${m.receiverRef}` : ""} · order #{m.documentId} · key <span className="mono">{m.idempotencyKey}</span></p>
          {m.compliance && <ComplianceBox result={m.compliance} sent={m.status === "delivered"} />}
          <ul className="attempts">{m.attempts.map((a, i) => <li key={i}>{a.outcome}: {a.detail}</li>)}</ul>
          <div className="btns">
            <button className="ghost" onClick={() => setOpen(open === m.id ? null : m.id)}>{open === m.id ? "Hide" : "Show"} message</button>
            <button className="ghost" onClick={() => download(m)}>Download</button>
            {m.status !== "delivered" && role !== "viewer" && (
              <button className="primary" onClick={() => wrap(() => agent.run({ type: "retryOutbound", role, messageId: m.id }))}>Retry safely</button>
            )}
          </div>
          {open === m.id && (
            <div className="edi-body">
              <pre className="raw" aria-label="Raw message">{m.body}</pre>
              <table className="lines mapping" aria-label="Field mapping">
                <thead><tr><th>Segment</th><th>What it says</th></tr></thead>
                <tbody>{m.mapping.map((x, i) => <tr key={i}><td className="mono">{x.segment}</td><td>{x.meaning}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}

/** Administrator demo control for the simulated retailer outbox. */
export function EdiSetting({ onError }: { onError: (e: string | null) => void }) {
  const agent = useAgent();
  return (
    <label>Retailer EDI outbox next message
      <select value={agent.state.portal?.ediFailureMode ?? "none"} onChange={(e) => {
        agent.run({ type: "setEdiFailureMode", role: "administrator", value: e.target.value as "none" })
          .then(() => onError(null), (err: Error) => onError(err.message));
      }}>
        <option value="none">Accepted</option><option value="hold_next">Stays pending</option><option value="fail_next">Fails</option>
      </select>
    </label>
  );
}
