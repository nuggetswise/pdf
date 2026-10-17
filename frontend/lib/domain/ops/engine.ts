// Order Operations engine (D71). Pure functions over OpsState: receive and read a sample email, match it to
// reference data, validate it, record human decisions, rerun validation, and send it to the simulated ERP.
// Behaviour model: sufficient evidence -> process automatically; correctable discrepancy -> recommend a change;
// material ambiguity -> ask a person to choose; missing critical information -> block.
import { Dec, money } from "../money";
import { BUYERS, CATALOGUE, ERP_MASTER, ORDER_HISTORY, PRICE_LIST_VERSION, SUPPLIER, type Buyer, type Item } from "./reference";
import { SAMPLES, type SampleEmail } from "./samples";
import {
  OPS_SCHEMA, type Actor, type DecisionOutcome, type ErpAttempt, type FieldKey, type HeaderKey, type IssueOption,
  type LineKey, type OpsDecision, type OpsField, type OpsIssue, type OpsLine, type OpsOrder, type OpsState, type OrderState,
} from "./types";

export const SYSTEM: Actor = { kind: "system", name: "Order agent" };
export const AGENT: Actor = { kind: "agent", name: "Order agent (AI)" };
export const ERP: Actor = { kind: "erp", name: "Your ERP (simulated)" };

const HEADER_LABEL: Record<HeaderKey, string> = { po_number: "PO number", buyer: "Buyer", supplier: "Supplier",
  delivery_location: "Delivery location", delivery_date: "Delivery date" };
const LINE_LABEL: Record<LineKey, string> = { description: "Description", sku: "Item", quantity: "Quantity", unit: "Unit",
  unit_price: "Unit price" };
export const FIELD_LABEL: Record<FieldKey, string> = { ...HEADER_LABEL, ...LINE_LABEL };

export class OpsRefused extends Error {}

const addSeconds = (iso: string, s: number) => new Date(new Date(iso).getTime() + s * 1000).toISOString();
const buyerById = (id: string | null) => BUYERS.find((b) => b.id === id) ?? null;
const itemBySku = (sku: string | null) => CATALOGUE.find((i) => i.sku === sku) ?? null;
const active = (o: OpsOrder) => o.decisions.filter((d) => d.undoneAt === null);
const lastDecision = (o: OpsOrder, issueId: string) => [...active(o)].reverse().find((d) => d.issueId === issueId) ?? null;

/** Price for a unit on the order date, and the price that applied before it (if any). */
function priceOn(item: Item, unit: string, day: string) {
  const list = item.prices.filter((p) => p.unit === unit);
  const current = list.find((p) => p.from <= day && (p.to === null || day <= p.to)) ?? null;
  const previous = current ? list.find((p) => p.to !== null && p.to < current.from) ?? null : null;
  return { current, previous };
}

const TOKEN_STOP = new Set(["pack", "case", "x", "ml", "l"]);
const tokens = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]+/g, " ").split(" ").filter((t) => t && !TOKEN_STOP.has(t));
/** Catalogue items whose description contains every word of the printed description. */
export function descriptionCandidates(printed: string): Item[] {
  const want = tokens(printed);
  return CATALOGUE.filter((i) => { const have = new Set(tokens(i.description)); return want.every((t) => have.has(t)); });
}

export function matchBuyer(email: { from: string }, buyerName: string): Buyer | null {
  const domain = email.from.split("@")[1]?.toLowerCase();
  return BUYERS.find((b) => b.domain === domain && b.name.toLowerCase() === buyerName.toLowerCase()) ?? null;
}

// ---------- building the structured order from the source and the decisions ----------

type Built = { header: OpsOrder["header"]; lines: OpsLine[]; issues: OpsIssue[]; total: string };

function field(key: FieldKey, extracted: string | null, source: OpsField["source"], reference: string | null = null): OpsField {
  return { key, label: FIELD_LABEL[key], extracted, value: extracted, reference, state: extracted === null ? "missing" : "accepted",
    source, decisionId: null, note: null };
}

function issue(p: Partial<OpsIssue> & Pick<OpsIssue, "id" | "type" | "field" | "title" | "summary" | "whyItMatters" | "rule">): OpsIssue {
  return { severity: "blocking", lineIndex: null, original: null, expected: null, proposed: null, agentNote: null, options: [],
    evidence: [], actions: ["defer"], status: "open", decisionId: null, attemptId: null, ...p };
}

/** Rebuilds field values, field states and issues from what was read plus the person's active decisions. */
export function build(o: Pick<OpsOrder, "email" | "po" | "decisions" | "erp">): Built {
  const order = o as OpsOrder;
  const po = o.po;
  const issues: OpsIssue[] = [];
  const b = matchBuyer(o.email, po.buyerName);
  const apply = (f: OpsField, issueId: string, kinds: DecisionOutcome[]) => {
    const d = lastDecision(order, issueId);
    if (d && kinds.includes(d.outcome)) { f.value = d.value; f.decisionId = d.id; }
    return d;
  };

  const header: OpsOrder["header"] = {
    po_number: field("po_number", po.poNumber, { doc: "pdf", page: 1, region: "po_number" }),
    buyer: field("buyer", po.buyerName, { doc: "pdf", page: 1, region: "buyer" },
      b ? `Trading partner ${b.name}, ERP account ${b.erpAccount}` : null),
    supplier: field("supplier", po.supplierName, { doc: "pdf", page: 1, region: "supplier" }, SUPPLIER.name),
    delivery_location: field("delivery_location", po.shipTo?.code ?? null, po.shipTo ? { doc: "pdf", page: 1, region: "ship_to" } : null),
    delivery_date: field("delivery_date", po.deliveryDate, { doc: "pdf", page: 1, region: "delivery_date" }),
  };

  if (!po.poNumber) issues.push(issue({ id: "missing:po_number", type: "missing_required_data", field: "po_number",
    title: "PO number missing", summary: "The purchase order has no order number.",
    whyItMatters: "The buyer's order number is required on the ERP order and on every reply.",
    rule: { id: "R1", text: "Every order carries the buyer's PO number." } }));
  if (!b) issues.push(issue({ id: "missing:buyer", type: "missing_required_data", field: "buyer",
    title: "Buyer not recognized", summary: `${po.buyerName} (${o.email.from}) is not a trading partner on file.`,
    whyItMatters: "Prices, locations and the ERP account depend on the trading partner.",
    rule: { id: "R2", text: "The sender and buyer match one trading partner on file." } }));
  if (!po.deliveryDate) issues.push(issue({ id: "missing:delivery_date", type: "missing_required_data", field: "delivery_date",
    title: "Delivery date missing", summary: "The purchase order has no requested delivery date.",
    whyItMatters: "Ship dates and the delivery appointment are planned from this date.",
    rule: { id: "R4", text: "Every order carries a requested delivery date." } }));

  // Delivery location: missing or not on file blocks. A person may enter a location the buyer confirmed.
  const loc = header.delivery_location;
  if (b) {
    const onFile = b.locations.find((l) => l.code === loc.extracted);
    const locOptions: IssueOption[] = b.locations.map((l) => ({ id: l.code, label: `${l.name} (${l.code})`, value: l.code,
      details: [["Address", l.address]], recommended: false }));
    if (!loc.extracted || !onFile) {
      const missing = !loc.extracted;
      const id = missing ? "missing:delivery_location" : "invalid:delivery_location";
      const iss = issue({ id, type: missing ? "missing_required_data" : "validation_failure", field: "delivery_location",
        title: missing ? "Delivery location missing" : "Delivery location not on file",
        summary: missing ? "The PDF and the email do not name a ship-to location." : `Ship-to ${loc.extracted} is not on file for ${b.name}.`,
        whyItMatters: "The order cannot be routed or delivered without a confirmed ship-to.",
        rule: { id: "R3", text: "The ship-to is printed on the order and on file for the buyer." },
        original: loc.extracted, options: locOptions, actions: ["correct", "defer"],
        agentNote: missing ? `${b.name} has ${b.locations.length} locations on file. The order gives no evidence for any of them, so no location is proposed.` : null,
        evidence: [
          { kind: "source", text: missing ? "Ship-to block absent from the PDF." : `Printed ship-to: ${loc.extracted}`, source: { doc: "pdf", page: 1, region: "ship_to" } },
          { kind: "source", text: `Email text: "${o.email.body.join(" ")}"`, source: { doc: "email", page: 1, region: "body" } },
          { kind: "reference", text: `Locations on file: ${b.locations.map((l) => `${l.name} (${l.code})`).join(", ")}`, source: null },
        ] });
      const d = apply(loc, id, ["corrected_value"]);
      if (d?.outcome === "corrected_value") { iss.status = "resolved"; iss.decisionId = d.id; }
      if (d?.outcome === "deferred") { iss.decisionId = d.id; loc.note = "Waiting on the buyer"; }
      issues.push(iss);
    } else loc.reference = `${onFile.name}, ${onFile.address}`;
  }

  // Downstream rejections stay on the order as issues; a person's correction resolves them.
  for (const a of o.erp.attempts) {
    if (a.response.status !== "rejected" || a.reconciled) continue;
    const id = `erp:${a.id}`;
    const acct = ERP_MASTER.find((m) => m.account === a.request.account);
    const rejected = acct?.shipTos.find((s) => s.code === a.request.shipTo);
    const options: IssueOption[] = (acct?.shipTos ?? []).filter((s) => s.active).map((s) => ({ id: s.code, label: s.code, value: s.code,
      details: [["Address", s.address], ["Status in ERP", "Active"]], recommended: !!rejected && s.address === rejected.address }));
    const rec = options.find((x) => x.recommended);
    const iss = issue({ id, type: "downstream_rejection", field: a.response.field ?? "delivery_location", attemptId: a.id,
      title: "Rejected by your ERP", summary: a.response.message,
      whyItMatters: "The ERP holds no order. The buyer's order is not confirmed until the ERP accepts it.",
      rule: { id: a.response.code, text: "Your ERP customer master: orders use an active ship-to for the account." },
      original: a.request.shipTo, expected: rec?.value ?? null, proposed: rec?.value ?? null, options, actions: ["select", "defer"],
      agentNote: rec ? `${rec.value} is the active ship-to at the same street address as ${a.request.shipTo} in the ERP customer master.` : null,
      evidence: [
        { kind: "erp", text: `ERP response ${a.response.code}: ${a.response.message}`, source: null },
        ...(rejected ? [{ kind: "erp" as const, text: `${rejected.code}: ${rejected.address}. Inactive${rejected.note ? `, ${rejected.note.toLowerCase()}` : ""}.`, source: null }] : []),
        ...(rec ? [{ kind: "erp" as const, text: `${rec.value}: ${rec.details[0][1]}. Active.`, source: null }] : []),
        { kind: "source", text: `Printed ship-to: ${po.shipTo?.name ?? ""} (${po.shipTo?.code ?? "none"})`, source: { doc: "pdf", page: 1, region: "ship_to" } },
      ] });
    const d = apply(loc, id, ["selected_option", "corrected_value"]);
    if (d && d.outcome !== "deferred") { iss.status = "resolved"; iss.decisionId = d.id; }
    if (d?.outcome === "deferred") iss.decisionId = d.id;
    issues.push(iss);
  }
  if (loc.decisionId !== null && b) {
    const l = b.locations.find((x) => x.code === loc.value);
    const e = ERP_MASTER.find((m) => m.account === b.erpAccount)?.shipTos.find((s) => s.code === loc.value);
    loc.reference = l ? `${l.name}, ${l.address}` : e ? `ERP ship-to, ${e.address}` : null;
  }

  // Lines
  const lines: OpsLine[] = po.lines.map((pl, i) => {
    const src = (r: string) => ({ doc: "pdf" as const, page: 1, region: `l${i}.${r}` });
    const f: Record<LineKey, OpsField> = {
      description: field("description", pl.description, src("desc")),
      sku: field("sku", pl.itemCode, pl.itemCode ? src("code") : null),
      quantity: field("quantity", pl.quantity, src("qty")),
      unit: field("unit", pl.unit, src("unit")),
      unit_price: field("unit_price", pl.unitPrice, src("price")),
    };
    // Product match: printed item code first, then description.
    let item = CATALOGUE.find((c) => c.sku === pl.itemCode || c.gtin === pl.itemCode) ?? null;
    if (item) f.sku.value = item.sku;
    else {
      const cands = descriptionCandidates(pl.description);
      const id = `product:l${i}`;
      if (cands.length === 1) { item = cands[0]; f.sku.value = item.sku; f.sku.note = "Matched by description"; }
      else if (cands.length > 1) {
        const hist = (sku: string) => ORDER_HISTORY.find((h) => h.buyerId === b?.id && h.sku === sku);
        const iss = issue({ id, type: "ambiguous_match", field: "sku", lineIndex: i, title: "Product needs a choice",
          summary: `"${pl.description}" matches ${cands.length} catalogue items.`,
          whyItMatters: "Shipping the wrong item creates a return and a short shipment.",
          rule: { id: "R5", text: "Each line matches exactly one catalogue item." }, original: pl.description, actions: ["select", "defer"],
          agentNote: "The printed description fits each option equally. Size is not printed, and no option is proposed.",
          options: cands.map((c) => {
            const h = hist(c.sku);
            const p = priceOn(c, c.units[0], po.orderDate).current;
            return { id: c.sku, label: c.description, value: c.sku, recommended: false, details: [["Item", c.sku], ["Size", c.size],
              ["Pack", c.pack], ["List price", p ? `${p.price} USD per ${p.unit}` : "Not on price list"],
              ["Last ordered by this buyer", h ? `${h.last} (${h.orders} orders)` : "No recent orders"]] };
          }),
          evidence: [
            { kind: "source", text: `Printed line ${pl.line}: ${pl.description}, ${pl.quantity} ${pl.unit} at ${pl.unitPrice} USD, no item code`, source: src("desc") },
            { kind: "reference", text: `Catalogue items matching every printed word: ${cands.map((c) => c.sku).join(", ")}`, source: null },
            { kind: "rule", text: `Printed price ${pl.unitPrice} matches the list price of ${cands.filter((c) => priceOn(c, c.units[0], po.orderDate).current?.price === pl.unitPrice).length} options`, source: src("price") },
          ] });
        const d = apply(f.sku, id, ["selected_option"]);
        if (d?.outcome === "selected_option") { iss.status = "resolved"; iss.decisionId = d.id; item = itemBySku(d.value); }
        if (d?.outcome === "deferred") iss.decisionId = d.id;
        issues.push(iss);
      } else {
        issues.push(issue({ id, type: "missing_required_data", field: "sku", lineIndex: i, title: "No product match",
          summary: `"${pl.description}" does not match any catalogue item.`, whyItMatters: "The ERP order needs an item for every line.",
          rule: { id: "R5", text: "Each line matches exactly one catalogue item." }, original: pl.itemCode ?? pl.description,
          evidence: [{ kind: "source", text: `Printed line ${pl.line}: ${pl.itemCode ?? "no code"} ${pl.description}`, source: src("desc") }] }));
      }
    }
    if (item) { f.sku.reference = `${item.sku}, ${item.description}`; f.description.reference = item.description; }

    // Unit
    let unitOk = false;
    if (item) {
      f.unit.reference = item.unitNote;
      if (item.units.includes(pl.unit)) unitOk = true;
      else {
        const alt = item.units.find((u) => priceOn(item!, u, po.orderDate).current?.price === pl.unitPrice) ?? null;
        const hist = ORDER_HISTORY.find((h) => h.buyerId === b?.id && h.sku === item!.sku);
        const id = `unit:l${i}`;
        if (alt) {
          const iss = issue({ id, type: "correctable_discrepancy", field: "unit", lineIndex: i, title: "Unit of measure mismatch",
            summary: `Received ${pl.quantity} ${pl.unit}; ${item.sku} is ordered in ${alt}.`,
            whyItMatters: `${pl.unit} is not an orderable unit for ${item.sku}, so the ERP cannot take the line as printed.`,
            rule: { id: "R6", text: "The unit is an orderable unit for the item." },
            original: `${pl.quantity} ${pl.unit}`, expected: `${pl.quantity} ${alt}`, proposed: alt, actions: ["accept", "keep_original"],
            agentNote: `Change ${pl.unit} to ${alt}. The printed price ${pl.unitPrice} USD is the price of one ${alt}${hist ? `, and this buyer used ${hist.unit} on its last ${hist.orders} orders of this item` : ""}. The quantity stays ${pl.quantity}.`,
            evidence: [
              { kind: "source", text: `Printed line ${pl.line}: ${pl.quantity} ${pl.unit} at ${pl.unitPrice} USD`, source: src("unit") },
              { kind: "reference", text: `${item.sku} orderable units: ${item.units.join(", ")} (${item.unitNote.toLowerCase()})`, source: null },
              { kind: "reference", text: `List price per ${alt}: ${priceOn(item, alt, po.orderDate).current!.price} USD (${PRICE_LIST_VERSION})`, source: src("price") },
              ...(hist ? [{ kind: "history" as const, text: `${b!.name} ordered ${item.sku} in ${hist.unit} on its last ${hist.orders} orders (latest ${hist.last})`, source: null }] : []),
            ] });
          const d = apply(f.unit, id, ["accepted_recommendation"]);
          if (d && d.outcome !== "deferred") { iss.status = "resolved"; iss.decisionId = d.id; }
          issues.push(iss);
          if (d?.outcome === "accepted_recommendation") unitOk = true;
          if (d?.outcome === "rejected_recommendation") {
            f.unit.decisionId = d.id;
            issues.push(issue({ id: `unit-invalid:l${i}`, type: "validation_failure", field: "unit", lineIndex: i,
              title: "Unit cannot be ordered", summary: `${pl.unit} is kept as printed and is not an orderable unit for ${item.sku}.`,
              whyItMatters: "The ERP rejects lines in units the item is not sold in. Undo the decision or confirm the unit with the buyer.",
              rule: { id: "R6", text: "The unit is an orderable unit for the item." }, original: pl.unit, expected: alt,
              evidence: [{ kind: "reference", text: `${item.sku} orderable units: ${item.units.join(", ")}`, source: null }] }));
          }
        } else {
          issues.push(issue({ id: `unit-invalid:l${i}`, type: "validation_failure", field: "unit", lineIndex: i, title: "Unit cannot be ordered",
            summary: `${pl.unit} is not an orderable unit for ${item.sku}.`, whyItMatters: "The ERP rejects lines in units the item is not sold in.",
            rule: { id: "R6", text: "The unit is an orderable unit for the item." }, original: pl.unit,
            evidence: [{ kind: "reference", text: `${item.sku} orderable units: ${item.units.join(", ")}`, source: null }] }));
        }
      }
    }

    // Price, against the price list in force on the order date
    if (!item) f.unit_price.note = "Checked against the price list once the item is known";
    else if (!unitOk) f.unit_price.note = "Checked against the price list once the unit is resolved";
    if (item && unitOk) {
      const unit = f.unit.value!;
      const { current, previous } = priceOn(item, unit, po.orderDate);
      f.unit_price.reference = current ? `${current.price} USD per ${unit} (${PRICE_LIST_VERSION})` : null;
      if (current && current.price !== pl.unitPrice) {
        const stale = previous?.price === pl.unitPrice;
        const id = `price:l${i}`;
        const iss = issue({ id, type: "correctable_discrepancy", field: "unit_price", lineIndex: i, title: "Price differs from price list",
          summary: `Printed ${pl.unitPrice} USD; price list ${current.price} USD per ${unit}.`,
          whyItMatters: "An unexplained price difference becomes an invoice dispute with the buyer.",
          rule: { id: "R7", text: "The unit price matches the price list in force on the order date." },
          original: pl.unitPrice, expected: current.price, proposed: current.price, actions: ["accept", "keep_original"],
          agentNote: stale ? `Change the price to ${current.price} USD. ${pl.unitPrice} USD is the price that ended ${previous!.to}; the order is dated ${po.orderDate}.`
            : `Change the price to the list price ${current.price} USD. No earlier price explains the printed value.`,
          evidence: [
            { kind: "source", text: `Printed unit price: ${pl.unitPrice} USD per ${pl.unit}`, source: src("price") },
            { kind: "reference", text: `${PRICE_LIST_VERSION}: ${current.price} USD per ${unit} from ${current.from}`, source: null },
            ...(stale ? [{ kind: "reference" as const, text: `Previous price ${previous!.price} USD applied ${previous!.from} to ${previous!.to}`, source: null }] : []),
            { kind: "source", text: `Order date: ${po.orderDate}`, source: { doc: "pdf", page: 1, region: "order_date" } },
          ] });
        const d = apply(f.unit_price, id, ["accepted_recommendation"]);
        if (d && d.outcome !== "deferred") { iss.status = "resolved"; iss.decisionId = d.id; }
        if (d?.outcome === "rejected_recommendation") {
          iss.severity = "warning";
          f.unit_price.decisionId = d.id;
          f.unit_price.note = `Printed price kept by a person; differs from the price list (${current.price} USD)`;
        }
        issues.push(iss);
      }
    }
    const q = Dec.parse(f.quantity.value ?? "");
    const p = Dec.parse(f.unit_price.value ?? "");
    const amount = q instanceof Dec && p instanceof Dec ? money(q.mul(p)) : null;
    return { index: i, fields: f, amount };
  });

  // Field states, from the issues and decisions just computed.
  const fieldOf = (iss: OpsIssue): OpsField => (iss.lineIndex === null ? header[iss.field as HeaderKey] : lines[iss.lineIndex].fields[iss.field as LineKey]);
  for (const f of [...Object.values(header), ...lines.flatMap((l) => Object.values(l.fields))]) {
    if (f.value !== f.extracted && f.decisionId !== null) f.state = "changed";
    else f.state = f.value === null ? "missing" : "accepted";
  }
  for (const iss of issues) {
    if (iss.status !== "open") continue;
    const f = fieldOf(iss);
    if (iss.type === "ambiguous_match" || iss.type === "correctable_discrepancy") f.state = "uncertain";
    else if (iss.type === "missing_required_data" && f.value === null) f.state = "missing";
    else f.state = "invalid";
  }
  const total = lines.reduce((t, l) => (l.amount ? t.add(Dec.of(l.amount)) : t), Dec.ZERO);
  return { header, lines, issues, total: money(total) };
}

// ---------- state ----------

const openBlocking = (o: Pick<OpsOrder, "issues">) => o.issues.filter((i) => i.status === "open" && i.severity === "blocking");

/** The state the order's issues, decisions and ERP result put it in (sending is entered only by send). */
export function stateFor(o: OpsOrder): OrderState {
  const open = openBlocking(o);
  if (o.erp.status === "accepted") return "accepted";
  if (open.some((i) => i.type === "downstream_rejection")) return "rejected";
  if (open.some((i) => i.type === "missing_required_data")) return "blocked";
  if (open.length) return "needs_review";
  return "ready_to_send";
}

/** An order with no human decision and no earlier ERP attempt goes to the ERP without anyone touching it. */
const eligibleForAutomaticSend = (o: OpsOrder) => active(o).length === 0 && o.erp.attempts.length === 0;

function event(o: OpsOrder, at: string, actor: Actor, type: string, text: string, extra: { field?: FieldKey | null; issueId?: string | null } = {}) {
  o.history.push({ id: o.history.length + 1, at, actor, type, text, field: extra.field ?? null, issueId: extra.issueId ?? null });
}

function rebuild(o: OpsOrder) {
  const b = build(o);
  o.header = b.header; o.lines = b.lines; o.issues = b.issues; o.total = b.total;
}

function validationSummary(o: OpsOrder): string {
  const open = o.issues.filter((i) => i.status === "open");
  if (!open.length) return "Validation completed. All checks passed.";
  return `Validation completed. ${open.length} open issue${open.length === 1 ? "" : "s"}: ${open.map((i) => i.title.toLowerCase()).join("; ")}.`;
}

/** After validation: set the state and, when eligible, send to the ERP. */
function settle(o: OpsOrder, at: string) {
  const s = stateFor(o);
  o.state = s;
  o.erp.status = o.erp.status === "accepted" ? "accepted" : s === "rejected" ? "rejected" : s === "ready_to_send" ? "ready" : "not_sent";
  if (s !== "ready_to_send") return;
  if (eligibleForAutomaticSend(o)) {
    event(o, at, SYSTEM, "structured", "Structured order created. No person needed.");
    send(o, at);
  } else event(o, at, SYSTEM, "ready", "Structured order updated. Approval required because a person changed this order.");
}

// ---------- simulated downstream ERP ----------

/** Deterministic ERP rules over its own customer master. No random failures. */
export function erpRespond(req: ErpAttempt["request"], orderId: string): ErpAttempt["response"] {
  const acct = ERP_MASTER.find((m) => m.account === req.account);
  if (!acct) return { status: "rejected", code: "ACCOUNT_UNKNOWN", message: `Customer account ${req.account ?? "(none)"} does not exist in the ERP.`, field: "buyer", erpOrderId: null };
  const st = acct.shipTos.find((s) => s.code === req.shipTo);
  if (!st || !st.active) {
    return { status: "rejected", code: "SHIPTO_INACTIVE", field: "delivery_location", erpOrderId: null,
      message: `Ship-to ${req.shipTo} is not active for customer account ${req.account}${st?.note ? ` (${st.note.toLowerCase()})` : ""}. Use an active ship-to for this account.` };
  }
  return { status: "accepted", code: "CREATED", message: "Sales order created.", field: null, erpOrderId: `SIM-SO-${60000 + Number(orderId.replace(/\D/g, ""))}` };
}

function send(o: OpsOrder, at: string) {
  const key = `${o.id}:v${o.version}`;
  o.state = "sending"; o.erp.status = "sending";
  const b = buyerById(o.buyerId);
  const request: ErpAttempt["request"] = { poNumber: o.header.po_number.value, account: b?.erpAccount ?? null,
    shipTo: o.header.delivery_location.value, deliveryDate: o.header.delivery_date.value, total: o.total,
    lines: o.lines.map((l) => ({ sku: l.fields.sku.value, quantity: l.fields.quantity.value, unit: l.fields.unit.value, unitPrice: l.fields.unit_price.value })) };
  event(o, at, SYSTEM, "erp_sent", `Sent to your ERP, simulated (request ${key}).`);
  const earlier = o.erp.attempts.find((a) => a.idempotencyKey === key);
  const response = earlier ? earlier.response : erpRespond(request, o.id);
  const respondedAt = addSeconds(at, 1);
  o.erp.attempts.push({ id: o.erp.attempts.length + 1, idempotencyKey: key, version: o.version, sentAt: at, respondedAt, request, response, reconciled: !!earlier });
  o.erp.status = "response_received";
  event(o, respondedAt, ERP, "erp_response", earlier ? "Response matched an earlier request with the same key. No duplicate order created." : `Response received: ${response.code}.`);
  if (response.status === "accepted") {
    o.erp.status = "accepted"; o.erp.erpOrderId = response.erpOrderId; o.state = "accepted";
    event(o, respondedAt, ERP, "erp_accepted", `Accepted by your ERP as ${response.erpOrderId}.`);
  } else {
    rebuild(o);
    o.erp.status = "rejected"; o.state = "rejected";
    event(o, respondedAt, ERP, "erp_rejected", `Rejected by your ERP: ${response.message}`, { field: response.field, issueId: `erp:${o.erp.attempts.length}` });
    const iss = o.issues.find((i) => i.id === `erp:${o.erp.attempts.length}`);
    if (iss?.proposed) event(o, respondedAt, AGENT, "recommendation", `Recommended ship-to ${iss.proposed}: ${iss.agentNote}`, { field: iss.field, issueId: iss.id });
  }
}

// ---------- receiving and reading a sample email ----------

export function receiveSample(s: SampleEmail, now: string): OpsOrder {
  const receivedAt = new Date(new Date(now).getTime() - s.minutesAgo * 60_000).toISOString();
  const b = BUYERS.find((x) => x.id === s.buyerId)!;
  const email = { from: `${s.fromUser}@${b.domain}`, fromName: s.fromName, to: SUPPLIER.mailbox, subject: s.subject, receivedAt, body: s.body };
  const o: OpsOrder = {
    id: s.id, sample: true, channel: "email_pdf", email,
    attachment: { filename: `${s.po.poNumber ?? s.id}.pdf`, sizeKb: 84 + s.po.lines.length * 6, pages: 1, recognizedAs: "purchase_order" },
    po: s.po, buyerId: null, header: {} as OpsOrder["header"], lines: [], total: "0.00", issues: [], decisions: [], approval: null,
    state: "received", version: 1, erp: { status: "not_sent", attempts: [], erpOrderId: null }, history: [],
  };
  event(o, receivedAt, SYSTEM, "received", `Email received from ${email.from} with 1 PDF attachment.`);
  o.state = "understanding";
  const t = (n: number) => addSeconds(receivedAt, n);
  event(o, t(2), SYSTEM, "pdf_identified", `${o.attachment.filename} identified as a purchase order.`);
  rebuild(o);
  const read = 5 + o.lines.length * 5;
  event(o, t(6), SYSTEM, "extracted", `Order fields extracted: ${read} values from page 1, each linked to its place in the PDF.`);
  o.state = "validating";
  const buyer = matchBuyer(email, s.po.buyerName);
  o.buyerId = buyer?.id ?? null;
  event(o, t(7), SYSTEM, "buyer_matched", buyer ? `Buyer matched to trading partner ${buyer.name} (ERP account ${buyer.erpAccount}).` : "Buyer not matched to a trading partner.", { field: "buyer" });
  const matched = o.lines.filter((l) => l.fields.sku.value && !o.issues.some((i) => i.id === `product:l${l.index}`)).length;
  event(o, t(8), SYSTEM, "products_matched", `${matched} of ${o.lines.length} line${o.lines.length === 1 ? "" : "s"} matched to catalogue items.`, { field: "sku" });
  event(o, t(9), SYSTEM, "validated", validationSummary(o));
  for (const iss of o.issues) {
    if (iss.proposed) event(o, t(9), AGENT, "recommendation", `Recommended: ${iss.agentNote}`, { field: iss.field, issueId: iss.id });
    else if (iss.agentNote) event(o, t(9), AGENT, "explanation", iss.agentNote, { field: iss.field, issueId: iss.id });
  }
  settle(o, t(10));
  return o;
}

export function seedInbox(now: string): OpsState {
  return { schema: OPS_SCHEMA, seededAt: now, orders: SAMPLES.map((s) => receiveSample(s, now)) };
}

// ---------- a person's actions ----------

function edit(state: OpsState, orderId: string, f: (o: OpsOrder) => void): OpsState {
  const idx = state.orders.findIndex((o) => o.id === orderId);
  if (idx < 0) throw new OpsRefused("Order not found.");
  const o: OpsOrder = structuredClone(state.orders[idx]);
  f(o);
  const orders = [...state.orders];
  orders[idx] = o;
  return { ...state, orders };
}

const EDITABLE: OrderState[] = ["needs_review", "blocked", "rejected", "ready_to_send"];
const OUTCOME_TEXT: Record<DecisionOutcome, string> = { accepted_recommendation: "Recommendation accepted",
  rejected_recommendation: "Recommendation rejected; original value kept", selected_option: "Option selected",
  corrected_value: "Value corrected", deferred: "Deferred" };

export type DecisionInput =
  | { outcome: "accepted_recommendation" }
  | { outcome: "rejected_recommendation" }
  | { outcome: "selected_option"; optionId: string }
  | { outcome: "corrected_value"; value: string; confirmedByBuyer: boolean }
  | { outcome: "deferred" };

export function decide(state: OpsState, orderId: string, issueId: string, input: DecisionInput, actor: Actor, at: string): OpsState {
  return edit(state, orderId, (o) => {
    if (!EDITABLE.includes(o.state)) throw new OpsRefused("This order can no longer be changed.");
    const iss = o.issues.find((i) => i.id === issueId);
    if (!iss || iss.status !== "open") throw new OpsRefused("This issue is not open.");
    const f = iss.lineIndex === null ? o.header[iss.field as HeaderKey] : o.lines[iss.lineIndex].fields[iss.field as LineKey];
    let value: string | null = f.value;
    switch (input.outcome) {
      case "accepted_recommendation":
        if (!iss.actions.includes("accept") || iss.proposed === null) throw new OpsRefused("This issue has no recommendation to accept.");
        value = iss.proposed; break;
      case "rejected_recommendation":
        if (!iss.actions.includes("keep_original")) throw new OpsRefused("This issue has no recommendation to reject.");
        value = f.extracted; break;
      case "selected_option": {
        const opt = iss.options.find((x) => x.id === input.optionId);
        if (!iss.actions.includes("select") || !opt) throw new OpsRefused("Select one of the listed options.");
        value = opt.value; break;
      }
      case "corrected_value":
        if (!iss.actions.includes("correct")) throw new OpsRefused("This value cannot be corrected here.");
        if (!input.confirmedByBuyer) throw new OpsRefused("Confirm that the buyer supplied this value.");
        if (!iss.options.some((x) => x.value === input.value)) throw new OpsRefused("Select a location on file for this buyer.");
        value = input.value; break;
      case "deferred":
        if (!iss.actions.includes("defer")) throw new OpsRefused("This issue cannot be deferred.");
        break;
    }
    const d: OpsDecision = { id: o.decisions.length + 1, issueId, outcome: input.outcome, field: iss.field, lineIndex: iss.lineIndex,
      previous: f.value, value: input.outcome === "deferred" ? null : value, actor, at, undoneAt: null };
    o.decisions.push(d);
    o.version += 1;
    o.approval = null;
    const where = iss.lineIndex === null ? FIELD_LABEL[iss.field] : `Line ${iss.lineIndex + 1} ${FIELD_LABEL[iss.field].toLowerCase()}`;
    const what = input.outcome === "deferred" ? `${iss.title}: deferred, waiting on the buyer.`
      : input.outcome === "rejected_recommendation" ? `${where}: kept original value ${f.extracted ?? "(none)"}; recommendation ${iss.proposed} rejected.`
      : `${where} changed from ${f.value ?? "(none)"} to ${value}${input.outcome === "corrected_value" ? " (confirmed by the buyer)" : ""}.`;
    event(o, at, actor, "decision", `${OUTCOME_TEXT[input.outcome]}. ${what}`, { field: iss.field, issueId });
    rebuild(o);
    event(o, at, SYSTEM, "validated", `Validation rerun. ${validationSummary(o).replace("Validation completed. ", "")}`);
    settle(o, at);
  });
}

/** True when the decision can still be reversed: no ERP submission since it was made, and the order is not final. */
export function canUndo(o: OpsOrder, d: OpsDecision): boolean {
  return d.undoneAt === null && EDITABLE.includes(o.state) && !o.erp.attempts.some((a) => a.sentAt >= d.at);
}

export function undoDecision(state: OpsState, orderId: string, decisionId: number, actor: Actor, at: string): OpsState {
  return edit(state, orderId, (o) => {
    const d = o.decisions.find((x) => x.id === decisionId);
    if (!d || !canUndo(o, d)) throw new OpsRefused("This decision can no longer be undone.");
    d.undoneAt = at;
    o.version += 1;
    o.approval = null;
    event(o, at, actor, "decision_undone", `Decision undone: ${OUTCOME_TEXT[d.outcome].toLowerCase()} on ${FIELD_LABEL[d.field].toLowerCase()}${d.lineIndex !== null ? ` (line ${d.lineIndex + 1})` : ""}.`, { field: d.field, issueId: d.issueId });
    rebuild(o);
    event(o, at, SYSTEM, "validated", `Validation rerun. ${validationSummary(o).replace("Validation completed. ", "")}`);
    settle(o, at);
  });
}

/** One click: the person's approval sends the order. There is no separate send step. */
export function approveAndSend(state: OpsState, orderId: string, actor: Actor, at: string): OpsState {
  return edit(state, orderId, (o) => {
    if (stateFor(o) !== "ready_to_send" || o.state !== "ready_to_send") throw new OpsRefused("Resolve every blocking issue before sending.");
    o.approval = { actor, at, version: o.version };
    event(o, at, actor, "approved", o.erp.attempts.length ? "Correction approved; order resent." : "Order approved for sending.");
    send(o, at);
  });
}

// ---------- read models ----------

export type Counts = { received: number; automatic: number; afterReview: number; needsReview: number; blocked: number;
  rejected: number; inProgress: number };

export const isAutomatic = (o: OpsOrder) => o.state === "accepted" && o.decisions.length === 0;

export function counts(s: OpsState): Counts {
  const c: Counts = { received: s.orders.length, automatic: 0, afterReview: 0, needsReview: 0, blocked: 0, rejected: 0, inProgress: 0 };
  for (const o of s.orders) {
    if (o.state === "accepted") { if (isAutomatic(o)) c.automatic++; else c.afterReview++; }
    else if (o.state === "needs_review") c.needsReview++;
    else if (o.state === "blocked") c.blocked++;
    else if (o.state === "rejected") c.rejected++;
    else c.inProgress++;
  }
  return c;
}

export const needsAttention = (o: OpsOrder) => ["needs_review", "blocked", "rejected", "ready_to_send"].includes(o.state);

/** The first open issue, most severe first: downstream rejection, blocked, then review. */
export function primaryIssue(o: OpsOrder): OpsIssue | null {
  const rank: Record<string, number> = { downstream_rejection: 0, missing_required_data: 1, validation_failure: 2, ambiguous_match: 3, correctable_discrepancy: 4 };
  return [...o.issues].filter((i) => i.status === "open").sort((a, b) => rank[a.type] - rank[b.type])[0] ?? null;
}

export function isOpsState(v: unknown): v is OpsState {
  return !!v && typeof v === "object" && (v as OpsState).schema === OPS_SCHEMA && Array.isArray((v as OpsState).orders);
}

