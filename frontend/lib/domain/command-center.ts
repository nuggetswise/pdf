// Proposed Retail Command Center (D66): Detect, Prioritise, Act, Verify, over the records this run already holds.
// Nothing here is a second place to edit an order: findings point at the order workspace, where the authorised
// action happens, and are verified only from source records (ERP simulator, Trading Grid outbox, retailer response).
//
// Rules of the composition:
// - A finding is derived from application records; every statement on it says what kind of statement it is
//   (observed fact, rule, human decision, confirmed outcome). No AI is used to detect, rank or verify.
// - One open finding per condition (its key). History is kept when the condition changes or clears.
// - Action status and verification are separate: an action can be complete while its outcome is still unverified.
// - Each type defines its resolution condition before it is evaluated. Missing evidence keeps verification pending.
// - No financial exposure, chargebacks, OTIF impact, deadlines or root causes are invented; absent = "Not established".
import { addDays } from "./dates";
import { Dec } from "./money";
import { type Clock, Conflict, Forbidden, type Who, systemClock } from "./workflow";
import type { CommandCenterState, Finding, FindingType, OutboundMessage, RunState } from "./run-state";

type Evidence = Finding["observed"][number];
type Condition = Pick<Finding, "type" | "key" | "documentId" | "customerId" | "poNumber" | "lines" | "visibility"
  | "observed" | "rule" | "deadline" | "priority" | "nextAction" | "resolution">;

export const FINDING_TITLE: Record<FindingType, string> = {
  stock_short: "Stock short for order",
  revised_delivery: "Revised delivery awaiting retailer",
  erp_outcome: "ERP order not confirmed",
  retailer_message: "Document not delivered to retailer",
};
/** Supplier people who can own a finding (demo identities, D22). The retailer side is one buyer per retailer. */
export const SUPPLIER_OWNERS = ["reviewer:rita", "administrator:alex"] as const;
export const retailerActor = (customerId: string) => `retailer:buyer@${customerId}`;

const emptyCc = (): CommandCenterState => ({ findings: [], ownership: {} });
const orderOf = (s: RunState, docId: number) => s.orders.find((o) => o.documentId === docId);
const lineLabel = (s: RunState, docId: number, lineIndex: number) => {
  const l = orderOf(s, docId)?.validation.order.lines.find((x) => x.line_index === lineIndex);
  return l ? `Line ${l.source_line_id}${l.description ? ` · ${l.description}` : ""}` : `Line ${lineIndex + 1}`;
};
const firstOrdrsp = (s: RunState, docId: number): OutboundMessage | undefined =>
  (s.portal?.outbound ?? []).filter((m) => m.kind === "ORDRSP" && m.documentId === docId && !m.idempotencyKey.includes(":reply-"))[0];
const receivedAt = (s: RunState, docId: number) => {
  const d = s.documents.find((x) => x.id === docId);
  const env = d && s.envelopes.find((e) => e.id === d.envelopeId);
  const t = env?.receivedAt && !Number.isNaN(Date.parse(env.receivedAt)) ? env.receivedAt : d?.createdAt;
  return t ?? null;
};
const hoursBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 3_600_000;

/** A deadline the PO itself states for reporting shortages ("Report expected shortages within 24 hours of order
 *  receipt"), measured from when the order was received. Null when the PO states none. */
function shortageDeadline(s: RunState, docId: number): Finding["deadline"] {
  const o = orderOf(s, docId);
  const terms = o && s.versions.find((v) => v.documentId === docId && v.version === o.currentVersion)?.payload.terms;
  for (const note of terms?.instructions ?? []) {
    const m = /\bshortages?\b.*?\bwithin\s+(\d{1,3})\s*(hours?|hrs?|days?)\b/i.exec(note.value ?? "");
    const from = receivedAt(s, docId);
    if (m && from) {
      const hours = Number.parseInt(m[1], 10) * (/^d/i.test(m[2]) ? 24 : 1);
      return { at: new Date(Date.parse(from) + hours * 3_600_000).toISOString(), source: `PO note: "${note.value}" (from order receipt)` };
    }
  }
  return null;
}

/** Explicit priority rules, applied in order. The basis names the rule and its source. */
function prioritise(now: string, deadline: Finding["deadline"], shipBy: string | null, blocks: string | null): Finding["priority"] {
  if (deadline && hoursBetween(now, deadline.at) <= 24) {
    return { level: "high", basis: `Deadline ${hoursBetween(now, deadline.at) < 0 ? "passed" : "within 24 hours"}: ${deadline.source}.` };
  }
  if (shipBy && shipBy <= addDays(now.slice(0, 10), 2)) {
    return { level: "high", basis: `Latest ship date ${shipBy} is within 2 days (from the PO's dates and transit days).` };
  }
  if (blocks) return { level: "medium", basis: `Blocks the order: ${blocks}.` };
  return { level: "low", basis: "Waiting on a response; no deadline is established." };
}

/** The parts of a delivered confirmation that ship less or later than the PO asked: a change the buyer must accept. */
function revisedParts(o: RunState["orders"][number] | undefined) {
  const f = o?.fulfilment;
  if (!f || f.status !== "confirmed") return [];
  return f.parts.filter((p) => p.kind !== "now" || (f.shipBy !== null && p.shipOn !== null && p.shipOn > f.shipBy));
}

// ---------- Detect ----------

export function detect(s: RunState, now: string): Condition[] {
  const out: Condition[] = [];
  for (const o of s.orders) {
    const docId = o.documentId;
    const base = { documentId: docId, customerId: o.customerId, poNumber: o.poNumber };
    const f = o.fulfilment;
    // Stock short when the ERP stock check needs a person's decision. Supplier-private: it rests on ERP stock.
    if (f?.status === "needs_decision") {
      const short = f.lines.filter((l) => Dec.ZERO.lt(Dec.of(l.short)));
      const deadline = shortageDeadline(s, docId);
      out.push({ ...base, type: "stock_short", key: `stock_short:${docId}`, visibility: "supplier",
        lines: short.map((l) => ({ lineIndex: l.lineIndex, label: lineLabel(s, docId, l.lineIndex) })),
        observed: short.map((l): Evidence => ({ kind: "observed",
          text: `${lineLabel(s, docId, l.lineIndex)}: ordered ${l.ordered}, free stock ${l.availableNow}, short ${l.short}` +
            (l.shortReadyOn ? `; more stock ${l.shortSource === "incoming" ? "expected" : "by lead time"} ${l.shortReadyOn}` : ""),
          source: `ERP stock check (simulated ERP), ${f.checkedOn}`, at: null })),
        rule: { text: "Short stock waits for a person's decision before the retailer is told (short-stock rule: ask).", source: "Settings, ship dates and short stock" },
        deadline,
        priority: prioritise(now, deadline, f.shipBy, "the order confirmation to the retailer waits for this decision"),
        nextAction: { text: "Choose how to ship: hold and ship complete, ship now and backorder, or ship now and cancel the rest.", target: "stock" },
        resolution: { condition: "Shipping decision recorded, the order confirmation delivered, and, when it changes quantities or dates, accepted by the retailer.",
          evidenceRequired: "Fulfilment decision with who and when; order confirmation (855) delivered with a receiver reference; for a changed confirmation, the retailer's recorded acceptance." } });
    }
    // ERP delivery failed or its outcome is unknown. Transport is not creation: only an ERP record verifies it.
    if (o.deliveryState === "failed" || o.deliveryState === "unknown") {
      const attempt = [...s.deliveries].reverse().find((d) => d.documentId === docId);
      out.push({ ...base, type: "erp_outcome", key: `erp_outcome:${docId}:v${o.currentVersion}`, visibility: "supplier", lines: [],
        observed: [{ kind: "observed", text: `Delivery ${o.deliveryState === "failed" ? "failed" : "outcome unknown"}: ${attempt?.detail ?? "no detail"}`,
          source: `Delivery attempt ${attempt?.id ?? "?"} (idempotency key ${attempt?.idempotencyKey ?? "?"})`, at: attempt?.updatedAt ?? null }],
        rule: { text: "An approved order is in the ERP only when the ERP holds a record for its idempotency key.", source: "ERP delivery rules" },
        deadline: null,
        priority: prioritise(now, null, o.fulfilment?.shipBy ?? null, "the order is approved but not confirmed in the ERP"),
        nextAction: { text: "Retry delivery. The agent checks the ERP for this order before sending it again.", target: "delivery" },
        resolution: { condition: "The ERP holds an order record for this approved version.",
          evidenceRequired: "ERP order number found for the idempotency key; delivery state In ERP." } });
    }
  }
  for (const m of s.portal?.outbound ?? []) {
    const o = orderOf(s, m.documentId);
    if (!o) continue;
    const base = { documentId: m.documentId, customerId: o.customerId, poNumber: o.poNumber };
    // A retailer-bound document that is held or not accepted by the outbox.
    if (m.channel === "retailer_edi_outbox" && m.status !== "delivered") {
      const last = m.attempts.at(-1);
      out.push({ ...base, type: "retailer_message", key: `retailer_message:${m.id}`, visibility: "supplier", lines: [],
        observed: [{ kind: "observed", text: `${m.kind} ${m.sourceId}: ${m.status}${last ? `, ${last.detail}` : ""}`,
          source: `Trading Grid outbox (simulated), message ${m.id}`, at: last?.at ?? m.createdAt }],
        rule: { text: "A retailer document counts as sent only when the outbox holds it.", source: "Outbound delivery rules" },
        deadline: null,
        priority: prioritise(now, null, o.fulfilment?.shipBy ?? null, "the retailer has not received this document"),
        nextAction: { text: m.attempts.some((a) => a.outcome === "held") ? "Fix the EDI setup named in the hold, then retry." : "Retry the delivery.", target: "outbound" },
        resolution: { condition: "The retailer's Trading Grid mailbox holds the document.",
          evidenceRequired: "Message status delivered with a receiver reference." } });
    }
    // A delivered confirmation that changes what or when the retailer receives. Shared: it rests on a document
    // the retailer already holds. Only the retailer's response verifies it; sending it does not.
    // Once the retailer accepts, the change is agreed and the condition no longer holds.
    const accepted = (s.portal?.retailerResponses ?? []).some((r) => r.messageId === m.id && r.decision === "accepted");
    if (m.kind === "ORDRSP" && m.status === "delivered" && o.fulfilment?.status === "confirmed" && m === firstOrdrsp(s, m.documentId) && !accepted) {
      const changed = revisedParts(o);
      if (changed.length) {
        out.push({ ...base, type: "revised_delivery", key: `revised_delivery:${m.id}`, visibility: "shared",
          lines: [...new Set(changed.map((p) => p.lineIndex))].map((i) => ({ lineIndex: i, label: lineLabel(s, m.documentId, i) })),
          observed: changed.map((p): Evidence => ({ kind: "observed",
            text: `${lineLabel(s, m.documentId, p.lineIndex)}: ${p.quantity} ${p.kind === "now" ? `ships ${p.shipOn} (after the PO's dates)` : p.kind === "backorder" ? `backordered to ${p.shipOn}` : "will not ship"}`,
            source: `Order confirmation ${m.sourceId} delivered as ${m.receiverRef}`, at: m.updatedAt })),
          rule: { text: "A confirmation that ships less or later than the PO asked is a change the buyer must accept.", source: "Order confirmation rules" },
          deadline: null,
          priority: prioritise(now, null, null, null),
          nextAction: { text: "Retailer buyer: accept or decline the revised quantities and dates.", target: "retailer_response" },
          resolution: { condition: "The retailer accepted the revised quantities and dates.",
            evidenceRequired: "Retailer response recorded as accepted for this confirmation. Delivery of the confirmation alone does not resolve it." } });
      }
    }
  }
  return out;
}

// ---------- Act and Verify, per type: what counts as the action and as the outcome ----------

function actionAndOutcome(s: RunState, f: Finding): { action: Evidence | null; outcome: Evidence[]; verified: boolean; next?: Finding["nextAction"] } {
  const o = orderOf(s, f.documentId);
  if (f.type === "stock_short") {
    const ful = o?.fulfilment;
    const action = ful?.status === "confirmed" && ful.decidedAt
      ? { kind: "human" as const, text: `Shipping decision: ${ful.choice?.replace("_", " ")}`, source: `Recorded by ${ful.decidedBy}`, at: ful.decidedAt } : null;
    const msg = firstOrdrsp(s, f.documentId);
    const outcome: Evidence[] = msg ? [{ kind: "outcome", text: `Order confirmation ${msg.sourceId}: ${msg.status}${msg.receiverRef ? ` as ${msg.receiverRef}` : ""}`,
      source: "Trading Grid outbox (simulated)", at: msg.updatedAt }] : [];
    // One shortage, one lifecycle: the confirmation is the supplier's action. When it changes what or when the
    // retailer receives, only the retailer's acceptance verifies it. Delivery alone does not.
    const delivered = Boolean(msg?.status === "delivered" && msg.receiverRef);
    const needsAcceptance = revisedParts(o).length > 0;
    const resp = msg ? [...(s.portal?.retailerResponses ?? [])].reverse().find((r) => r.messageId === msg.id) : undefined;
    if (resp) outcome.push({ kind: "outcome", text: `Retailer ${resp.decision} the revised quantities and dates (simulated retailer view)`,
      source: "Retailer response record", at: resp.at });
    const next = delivered && needsAcceptance
      ? { text: resp?.decision === "declined" ? "Agree a new plan with the buyer, then send a changed confirmation from the order."
        : "Wait for the retailer's response to the revised quantities and dates.", target: "stock" as const } : undefined;
    return { action, outcome, verified: Boolean(action && delivered && (!needsAcceptance || resp?.decision === "accepted")), next };
  }
  if (f.type === "erp_outcome") {
    const retry = s.audit.find((a) => a.entityType === "document" && a.entityId === f.documentId && a.event === "delivery_retry_requested" && a.createdAt >= f.detectedAt);
    const action = retry ? { kind: "human" as const, text: "Delivery retry requested", source: `Recorded by ${retry.actor}`, at: retry.createdAt } : null;
    const attempt = [...s.deliveries].reverse().find((d) => d.documentId === f.documentId && d.state === "erp_created");
    const erp = attempt && s.erpOrders.find((e) => e.idempotencyKey === attempt.idempotencyKey);
    const outcome: Evidence[] = erp ? [{ kind: "outcome", text: `ERP holds ${erp.erpOrderId} for idempotency key ${erp.idempotencyKey}`,
      source: "ERP simulator record", at: attempt!.updatedAt }] : [];
    return { action, outcome, verified: Boolean(erp && o?.deliveryState === "erp_created") };
  }
  if (f.type === "retailer_message") {
    const id = Number.parseInt(f.key.split(":")[1], 10);
    const msg = s.portal?.outbound.find((m) => m.id === id);
    const retry = msg?.attempts.filter((a) => a.at > f.detectedAt).at(-1);
    const action = retry ? { kind: "human" as const, text: `Delivery retried: ${retry.outcome}`, source: "Trading Grid outbox", at: retry.at } : null;
    const outcome: Evidence[] = msg?.status === "delivered" ? [{ kind: "outcome", text: `Delivered as ${msg.receiverRef}`, source: "Trading Grid outbox (simulated)", at: msg.updatedAt }] : [];
    return { action, outcome, verified: msg?.status === "delivered" && Boolean(msg.receiverRef) };
  }
  // revised_delivery
  const id = Number.parseInt(f.key.split(":")[1], 10);
  const resp = [...(s.portal?.retailerResponses ?? [])].reverse().find((r) => r.messageId === id);
  const action = resp ? { kind: "human" as const, text: `Retailer ${resp.decision} the revision (simulated retailer view)`, source: `Recorded by ${resp.by}`, at: resp.at } : null;
  const outcome: Evidence[] = resp?.decision === "accepted" ? [{ kind: "outcome", text: "Retailer accepted the revised quantities and dates", source: "Retailer response record", at: resp.at }] : [];
  const next = resp?.decision === "declined"
    ? { text: "Supplier: agree a new plan with the buyer, then send a changed confirmation from the order.", target: "stock" as const } : undefined;
  return { action, outcome, verified: resp?.decision === "accepted", next };
}

const sameObserved = (a: Evidence[], b: Evidence[]) => JSON.stringify(a.map((e) => e.text)) === JSON.stringify(b.map((e) => e.text));

/** Brings the findings up to date with the run's records. Idempotent: running it twice changes nothing. */
export function reconcileFindings(state: RunState, clock: Clock = systemClock): RunState {
  const now = clock.now();
  const conds = detect(state, now);
  const before = state.commandCenter ?? emptyCc();
  const cc: CommandCenterState = structuredClone(before);
  let changed = false;
  const nextId = () => cc.findings.reduce((m, f) => Math.max(m, f.id), 0) + 1;
  const open = (key: string) => cc.findings.find((f) => f.key === key && f.verification.status === "pending");
  for (const c of conds) {
    const f = open(c.key);
    // A verified finding stands while the same condition is still in the records (no second finding for it).
    const settled = cc.findings.some((x) => x.key === c.key && x.verification.status === "verified" && sameObserved(x.observed, c.observed));
    if (!f && settled) continue;
    if (!f) {
      const configured = cc.ownership[c.type] ?? (c.type === "revised_delivery" && c.customerId ? retailerActor(c.customerId) : null);
      cc.findings.push({ ...c, id: nextId(), detectedAt: now, observedAt: now, conditionActive: true,
        owner: configured ? { actor: configured, source: "configured", by: "system:order-agent", at: now } : null,
        actionStatus: "not_started", verification: { status: "pending", evidence: [], at: null },
        history: [{ at: now, kind: "detected", actor: "system:order-agent", text: c.observed.map((e) => e.text).join("; ") }] });
      changed = true;
      continue;
    }
    if (!f.conditionActive) {
      f.conditionActive = true;
      f.history.push({ at: now, kind: "reopened", actor: "system:order-agent", text: "Condition observed again." });
      changed = true;
    }
    if (!sameObserved(f.observed, c.observed)) {
      f.observed = c.observed;
      f.observedAt = now;
      f.history.push({ at: now, kind: "changed", actor: "system:order-agent", text: c.observed.map((e) => e.text).join("; ") });
      changed = true;
    }
    if (f.priority.level !== c.priority.level) { f.priority = c.priority; changed = true; }
  }
  for (const f of cc.findings) {
    if (f.verification.status !== "pending") continue;
    if (f.conditionActive && !conds.some((c) => c.key === f.key)) {
      f.conditionActive = false;
      f.history.push({ at: now, kind: "condition_cleared", actor: "system:order-agent", text: "Condition no longer observed in the source records." });
      changed = true;
    }
    const r = actionAndOutcome(state, f);
    if (r.action && f.actionStatus !== "completed") {
      f.actionStatus = "completed";
      f.history.push({ at: r.action.at ?? now, kind: "action", actor: r.action.source.replace(/^Recorded by /, ""), text: r.action.text });
      changed = true;
    }
    if (r.next && f.nextAction.text !== r.next.text) { f.nextAction = r.next; changed = true; }
    if (JSON.stringify(f.verification.evidence) !== JSON.stringify(r.outcome)) { f.verification.evidence = r.outcome; changed = true; }
    if (r.verified) {
      f.verification = { status: "verified", evidence: r.outcome, at: now };
      f.history.push({ at: now, kind: "verified", actor: "system:order-agent", text: `Resolution condition met: ${f.resolution.condition}` });
      changed = true;
    }
  }
  if (!changed) return state;
  return { ...state, commandCenter: cc };
}

// ---------- authorised actions taken from the Command Center itself ----------

/** Assign or unassign a finding. Supplier findings go to supplier people; a shared finding may go to the retailer. */
export function assignFinding(state: RunState, findingId: number, actor: string | null, who: Who, clock: Clock = systemClock): RunState {
  if (who.role !== "reviewer" && who.role !== "administrator") throw new Forbidden("Reviewer or administrator role required");
  const f = state.commandCenter?.findings.find((x) => x.id === findingId);
  if (!f) throw new Conflict("Unknown finding");
  const allowed: string[] = [...SUPPLIER_OWNERS, ...(f.visibility === "shared" && f.customerId ? [retailerActor(f.customerId)] : [])];
  if (actor !== null && !allowed.includes(actor)) throw new Conflict("Choose an owner who can see this finding");
  const s = structuredClone(state);
  const g = s.commandCenter!.findings.find((x) => x.id === findingId)!;
  const now = clock.now();
  g.owner = actor ? { actor, source: "assigned", by: who.actor, at: now } : null;
  g.history.push({ at: now, kind: "assigned", actor: who.actor, text: actor ? `Assigned to ${actor}` : "Unassigned" });
  s.audit.push({ id: s.audit.reduce((m, a) => Math.max(m, a.id), 0) + 1, entityType: "finding", entityId: findingId, event: "finding_assigned",
    actor: who.actor, detail: { owner: actor }, createdAt: now });
  return s;
}

/** The default owner for new findings of a type, or for order review issues ("order_review"), set by an administrator. */
export function setFindingOwnership(state: RunState, type: FindingType | "order_review", actor: string | null, who: Who): RunState {
  if (who.role !== "administrator") throw new Forbidden("Only an administrator can change ownership");
  if (actor !== null && !(SUPPLIER_OWNERS as readonly string[]).includes(actor)) throw new Conflict("Unknown owner");
  const s = structuredClone(state);
  s.commandCenter ??= emptyCc();
  s.commandCenter.ownership[type] = actor;
  return s;
}

/** The retailer's answer to a changed confirmation, recorded in the retailer view (simulated retailer system).
 *  The retailer can answer only for its own orders. */
export function respondToRevision(state: RunState, messageId: number, customerId: string, decision: "accepted" | "declined",
  clock: Clock = systemClock): RunState {
  const msg = state.portal?.outbound.find((m) => m.id === messageId);
  const order = msg && orderOf(state, msg.documentId);
  if (!msg || msg.kind !== "ORDRSP" || msg.status !== "delivered" || !order) throw new Conflict("No delivered confirmation with that number");
  if (order.customerId !== customerId) throw new Forbidden("This confirmation belongs to another retailer");
  if ((state.portal?.retailerResponses ?? []).some((r) => r.messageId === messageId)) throw new Conflict("This confirmation already has a response");
  const s = structuredClone(state);
  const now = clock.now();
  s.portal!.retailerResponses ??= [];
  const id = s.portal!.retailerResponses.reduce((m, r) => Math.max(m, r.id), 0) + 1;
  s.portal!.retailerResponses.push({ id, documentId: msg.documentId, messageId, decision, by: retailerActor(customerId), at: now });
  s.audit.push({ id: s.audit.reduce((m, a) => Math.max(m, a.id), 0) + 1, entityType: "document", entityId: msg.documentId,
    event: `retailer_revision_${decision}`, actor: retailerActor(customerId), detail: { message_id: messageId }, createdAt: now });
  return s;
}

/** Who owns an order's open review issues: the configured owner, else Unassigned. */
export const issueOwner = (s: RunState): string | null => s.commandCenter?.ownership.order_review ?? null;

// ---------- access ----------

/** What a retailer may see: shared findings on its own orders. Supplier-private findings (ERP stock, ERP delivery,
 *  the supplier's outbox problems) and other retailers' findings are never returned. */
export function retailerFindings(s: RunState, customerId: string): Finding[] {
  return (s.commandCenter?.findings ?? []).filter((f) => f.visibility === "shared" && f.customerId === customerId);
}
/** The supplier sees one finding per shortage: the retailer's copy of the same condition is evidence on it. */
export const supplierFindings = (s: RunState): Finding[] => {
  const all = s.commandCenter?.findings ?? [];
  return all.filter((f) => f.type !== "revised_delivery" || !all.some((x) => x.type === "stock_short" && x.documentId === f.documentId));
};

/** Counts derived from the findings, for the Command Center header. */
export function findingCounts(list: Finding[]) {
  return {
    open: list.filter((f) => f.verification.status === "pending").length,
    unassigned: list.filter((f) => f.verification.status === "pending" && !f.owner).length,
    awaitingEvidence: list.filter((f) => f.verification.status === "pending" && f.actionStatus === "completed").length,
    verified: list.filter((f) => f.verification.status === "verified").length,
  };
}
