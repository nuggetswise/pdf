"use client";
// Rules: what the portal compares every order with. The values belong to the supplier's ERP and are synced to the
// portal; nothing here can be edited. Below them, the checks the portal applies and the corrections reviewers
// have saved for reuse (the only part the portal owns).
import { showDate } from "../lib/domain/dates";
import { freeStock, fulfilmentSettings, reserved, stockOf } from "../lib/domain/fulfilment";
import { POLICY, TITLES, type IssueCode } from "../lib/domain/validation";
import bundledReferenceJson from "../lib/domain/reference-data.v1.json";
import type { Role } from "./api";
import { Corrections } from "./Corrections";
import { useAgent } from "./run/RunProvider";

type Ref = typeof bundledReferenceJson;

/** Which ERP table each check reads. */
const READS: Record<IssueCode, string> = {
  unknown_customer: "Retailers", unknown_ship_to: "Ship-to locations", missing_po_number: "The document",
  missing_currency: "The document", currency_mismatch: "Retailers", unverified_field: "The document",
  missing_line_value: "The document", unknown_item: "Items", unknown_unit: "Unit conversions",
  unit_conversion: "Unit conversions", moq_violation: "Minimum order quantities", price_mismatch: "Agreed prices",
  outdated_identifier: "Retired item codes", rule_needs_revalidation: "Approved corrections",
  line_amount_mismatch: "The document", total_mismatch: "The document", possible_revision: "Orders already received",
};
const SHORT_STOCK = { ask: "Ask each time", ship_complete: "Hold and ship complete", split: "Ship what is there, backorder the rest" } as const;

export function RulesView({ role }: { role: Role }) {
  const agent = useAgent();
  const s = agent.state;
  const ref = (s.settings.referenceData ?? bundledReferenceJson) as unknown as Ref;
  const name = (id: string) => ref.customers.find((c) => c.customer_id === id)?.name ?? id;
  const item = (sku: string) => ref.products.find((p) => p.sku === sku);
  const codes = Object.keys(POLICY) as IssueCode[];
  const ship = fulfilmentSettings(s);
  const stock = stockOf(s);
  return (
    <section className="rules" aria-label="Rules">
      <div className="sync-note" role="note">
        <b>Synced from your ERP.</b> These values are read-only here. Change them in your ERP and they reach the portal at the next sync.
        <span className="muted small"> Test environment: a bundled snapshot, <b>{ref.reference_version}</b>. Fictional data.</span>
      </div>

      <section className="panel" aria-labelledby="r-prices-h">
        <header className="panel-head"><h3 id="r-prices-h">Agreed prices</h3><span className="count muted">{ref.reference_prices.length}</span></header>
        <div className="scroll"><table className="table stack-table">
          <thead><tr><th>Retailer</th><th>Item</th><th>Price per unit</th></tr></thead>
          <tbody>{ref.reference_prices.map((p) => (
            <tr key={`${p.customer_id}:${p.sku}`}><td data-label="Retailer">{name(p.customer_id)}</td>
              <td data-label="Item"><b>{p.sku}</b> <span className="muted small">{item(p.sku)?.description}</span></td>
              <td data-label="Price per unit">{p.price} {p.currency} per {p.unit.toLowerCase()}</td></tr>
          ))}</tbody>
        </table></div>
      </section>

      <section className="panel" aria-labelledby="r-moq-h">
        <header className="panel-head"><h3 id="r-moq-h">Minimum order quantities</h3><span className="count muted">{ref.moq_rules.length}</span></header>
        <div className="scroll"><table className="table stack-table">
          <thead><tr><th>Retailer</th><th>Item</th><th>Minimum</th></tr></thead>
          <tbody>{ref.moq_rules.map((m) => (
            <tr key={m.rule_id}><td data-label="Retailer">{name(m.customer_id)}</td>
              <td data-label="Item"><b>{m.sku}</b> <span className="muted small">{item(m.sku)?.description}</span></td>
              <td data-label="Minimum">{m.minimum} {m.unit.toLowerCase()}s</td></tr>
          ))}</tbody>
        </table></div>
      </section>

      <section className="panel" aria-labelledby="r-stock-h">
        <header className="panel-head"><h3 id="r-stock-h">Stock and lead times</h3><span className="count muted">{stock.length}</span></header>
        <div className="scroll"><table className="table stack-table">
          <thead><tr><th>Item</th><th>On hand</th><th>Held for orders</th><th>Free</th><th>Incoming</th><th>Lead time</th></tr></thead>
          <tbody>{stock.map((i) => (
            <tr key={i.sku}><td data-label="Item"><b>{i.sku}</b> <span className="muted small">{item(i.sku)?.description}</span></td>
              <td data-label="On hand">{i.onHand}</td>
              <td data-label="Held for orders">{reserved(s, i.sku, null).toFixedPoint()}</td>
              <td data-label="Free">{freeStock(s, i.sku)?.toFixedPoint() ?? "–"}</td>
              <td data-label="Incoming">{i.incoming.length === 0 ? "None" : i.incoming.map((x) => `${x.quantity} on ${showDate(x.expected)} (${x.ref})`).join("; ")}</td>
              <td data-label="Lead time">{i.leadTimeDays} days</td></tr>
          ))}</tbody>
        </table></div>
        <p className="muted small">On hand is the ERP's figure. Held for orders is what confirmed orders in this portal have already promised to ship.</p>
      </section>

      <section className="panel" aria-labelledby="r-ship-h">
        <header className="panel-head"><h3 id="r-ship-h">Shipping values</h3></header>
        <dl className="facts">
          <div><dt>Working days to pick and pack</dt><dd>{ship.packDays}</dd></div>
          <div><dt>Working days in transit</dt><dd>{ship.transitDays}</dd></div>
          <div><dt>When stock is short</dt><dd>{SHORT_STOCK[ship.shortStock]}</dd></div>
        </dl>
        <p className="muted small">The portal uses these to promise a ship date and to decide whether a person must choose how to ship short stock.</p>
      </section>

      <section className="panel" aria-labelledby="r-units-h">
        <header className="panel-head"><h3 id="r-units-h">Unit conversions</h3><span className="count muted">{ref.unit_conversions.length}</span></header>
        <div className="scroll"><table className="table stack-table">
          <thead><tr><th>Item</th><th>Conversion</th></tr></thead>
          <tbody>{ref.unit_conversions.map((u) => (
            <tr key={`${u.sku}:${u.from_unit}`}><td data-label="Item"><b>{u.sku}</b> <span className="muted small">{item(u.sku)?.description}</span></td>
              <td data-label="Conversion">{u.factor} {u.from_unit === "EA" ? "each" : u.from_unit} = 1 {u.to_unit.toLowerCase()}</td></tr>
          ))}</tbody>
        </table></div>
      </section>

      <section className="panel" aria-labelledby="r-ship-tos-h">
        <header className="panel-head"><h3 id="r-ship-tos-h">Ship-to locations</h3></header>
        <div className="scroll"><table className="table stack-table">
          <thead><tr><th>Retailer</th><th>Code</th><th>Location</th></tr></thead>
          <tbody>{ref.customers.flatMap((c) => c.ship_tos.map((t) => (
            <tr key={t.ship_to_id}><td data-label="Retailer">{c.name}</td><td data-label="Code"><b>{t.ship_to_id}</b></td><td data-label="Location">{t.name}</td></tr>
          )))}</tbody>
        </table></div>
      </section>

      <section className="panel" aria-labelledby="r-retired-h">
        <header className="panel-head"><h3 id="r-retired-h">Retired item codes</h3><span className="count muted">{ref.obsolete_identifiers.length}</span></header>
        <div className="scroll"><table className="table stack-table">
          <thead><tr><th>Retired code</th><th>Replaced by</th><th>Source</th></tr></thead>
          <tbody>{ref.obsolete_identifiers.map((o) => {
            const m = ref.proposed_identifier_mappings.find((x) => x.obsolete_identifier === o.identifier);
            return (
              <tr key={o.identifier}><td data-label="Retired code"><b>{o.identifier}</b></td>
                <td data-label="Replaced by">{m ? <>{m.replacement_sku} <span className="muted small">GTIN {m.replacement_identifier}</span></> : "No replacement on file"}</td>
                <td data-label="Source">{m ? `${m.source}. A person approves the replacement the first time it is used.` : o.note}</td></tr>
            );
          })}</tbody>
        </table></div>
      </section>

      <section className="panel" aria-labelledby="doc-rules-h">
        <header className="panel-head"><h3 id="doc-rules-h">Checks the portal applies</h3><span className="count muted">{codes.length}</span></header>
        <p className="muted small">Every order passes through each check. A failed check stops the order until a person decides, in both approval modes.</p>
        <div className="scroll"><table className="table stack-table">
          <thead><tr><th>Check</th><th>Compared with</th><th>What a person can decide</th></tr></thead>
          <tbody>{codes.map((c) => (
            <tr key={c}><td data-label="Check">{TITLES[c]}</td><td data-label="Compared with">{READS[c]}</td>
              <td data-label="What a person can decide">{POLICY[c].actions.length ? POLICY[c].actions.map((a) => a.replace(/_/g, " ")).join(", ") : "Reject, or ask the retailer to correct it"}</td></tr>
          ))}</tbody>
        </table></div>
      </section>

      <Corrections role={role} />
    </section>
  );
}
