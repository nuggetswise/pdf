// Port of backend/app/workflow.py (plus the state changes of intake.py and pipeline.py) as pure functions
// over RunState. Every action takes the current run and returns the next one; nothing is kept elsewhere.
//
// Separate states are kept separate: processing (documents[].status) -> review (orders[].reviewState) ->
// approval (approvals[]) -> delivery (orders[].deliveryState, deliveries[]) -> ERP acknowledgement (erpOrders[]).
import { Dec, dec, money, qty } from "./money";
import { mergeReference } from "./onboarding";
import bundledReference from "./reference-data.v1.json";
import {
  type Approval, type AuditEvent, type Decision, type DeliveryAttempt, type MemoryRule, type Order,
  type OrderVersion, type PolicyChange, ReferenceData, type RunState, type SourceDocument, type ValidationResult,
  type Channel, HoldReason, RejectReason, emptyOverlay, emptyRunState,
} from "./run-state";
import { type Overrides, type Reference, validate } from "./validation";
import { applyChecks } from "./checks";
import { confirmOrder } from "./portal";

export const SYSTEM = "system:order-agent";
const REVIEWER_ROLES = new Set(["reviewer", "administrator"]);
const LINE_EDIT_ACTIONS = new Set(["change_quantity", "correct_price"]);
const REASON_REQUIRED = new Set(["one_off_exception", "accept_printed_price", "acknowledge_total_difference",
  "confirm_field", "accept_as_revision", "change_quantity", "correct_price"]);

/** Who acts: the demo role and the actor label "<role>:<name>" (D22, demo-only). */
export interface Who { actor: string; role: string }
export interface Clock { now: () => string }
export const systemClock: Clock = { now: () => new Date().toISOString() };

export class Forbidden extends Error {}
export class Conflict extends Error {}

type Issue = ValidationResult["issues"][number];
type Detail = AuditEvent["detail"];

// ---------- small helpers over the run ----------

class Run {
  constructor(readonly s: RunState, readonly clock: Clock) {}
  now() { return this.clock.now(); }
  nextId(rows: { id: number }[]) { return rows.reduce((m, r) => Math.max(m, r.id), 0) + 1; }

  audit(entityType: AuditEvent["entityType"], entityId: number, event: string, actor: string, detail: Detail = {}) {
    this.s.audit.push({ id: this.nextId(this.s.audit), entityType, entityId, event, actor, detail, createdAt: this.now() });
  }
  doc(id: number): SourceDocument {
    const d = this.s.documents.find((x) => x.id === id);
    if (!d) throw new Conflict("Unknown document");
    return d;
  }
  order(id: number): Order | undefined { return this.s.orders.find((o) => o.documentId === id); }
  /** workflow._status: a review-side status change, always audited. */
  status(docId: number, status: SourceDocument["status"], detail: Detail = {}) {
    const d = this.doc(docId);
    d.status = status;
    d.statusDetail = null;
    d.updatedAt = this.now();
    this.audit("document", docId, status, SYSTEM, detail);
  }
  policy(): PolicyChange { return this.s.policyHistory[this.s.policyHistory.length - 1]; }
  /** The reference file in use, without this session's additions. */
  baseReference(): Reference { return (this.s.settings.referenceData ?? bundledReference) as unknown as Reference; }
  /** What validation uses: the reference file plus this session's additions (D46). */
  reference(): Reference { return mergeReference(this.baseReference(), this.s.referenceOverlay); }
  latestVersion(docId: number): OrderVersion {
    return this.s.versions.filter((v) => v.documentId === docId).sort((a, b) => b.version - a.version)[0];
  }
  validApproval(docId: number, version: number): Approval | undefined {
    return this.s.approvals.find((a) => a.documentId === docId && a.version === version && a.invalidatedAt === null);
  }
  decisionsFor(docId: number): Decision[] {
    return this.s.decisions.filter((d) => d.documentId === docId).sort((a, b) => a.id - b.id);
  }
}

function act(state: RunState, clock: Clock, fn: (r: Run) => void): RunState {
  const r = new Run(structuredClone(state), clock);
  fn(r);
  return r.s;
}

const requireReviewer = (role: string) => {
  if (!REVIEWER_ROLES.has(role)) throw new Forbidden("Reviewer or administrator role required");
};
const nameOf = (actor: string) => { const i = actor.indexOf(":"); return i < 0 ? "" : actor.slice(i + 1); };

/** A memory rule as the Python row dict that validate() and the rules snapshot use. */
export function ruleRow(m: MemoryRule) {
  return {
    id: m.id, kind: m.kind, customer_id: m.customerId, obsolete_identifier: m.obsoleteIdentifier,
    replacement_identifier: m.replacementIdentifier, replacement_sku: m.replacementSku,
    reference_version: m.referenceVersion, state: m.state, source_document_id: m.sourceDocumentId,
    source_decision_id: m.sourceDecisionId, evidence: m.evidence, created_by: m.createdBy, created_at: m.createdAt,
    activated_by: m.activatedBy, activated_at: m.activatedAt, revoked_by: m.revokedBy, revoked_at: m.revokedAt,
    revoke_reason: m.revokeReason,
  };
}

// ---------- intake and extraction (state changes only; parsing happens in the browser, slice 4) ----------

export interface IncomingEnvelope {
  messageId: string | null; sender: string | null; receivedAt: string | null; subjectMetadata: string | null;
  intakeMode: RunState["envelopes"][number]["intakeMode"]; rawSha256: string | null;
}
export interface IncomingDocument {
  originalFilename: string | null; sha256: string; sizeBytes: number; pageCount: number; pageText: string[];
  /** D62: absent for a PDF. */
  kind?: "email_body" | "edi";
}
/** D62: the email's own text and every attachment it carried, kept as evidence on the envelope. */
export interface IncomingEmail {
  bodyText: string | null;
  seen: { filename: string | null; mimeType: string | null; sizeBytes: number; sha256: string;
    handling: "order_candidate" | "evidence_only"; note: string | null }[];
}

/** D62: the route an order arrived by. Supervision is set per retailer and route (D64). */
export function channelOf(s: RunState, docId: number): Channel {
  const d = s.documents.find((x) => x.id === docId);
  if (d?.kind === "email_body") return "email_body";
  if (d?.kind === "edi") return "edi";
  const env = d ? s.envelopes.find((e) => e.id === d.envelopeId) : undefined;
  return env?.intakeMode === "manual_upload" ? "upload" : "email_attachment";
}

/** intake.store_intake: one envelope and its PDFs. An identical file is marked duplicate and not processed. */
export function receive(state: RunState, envelope: IncomingEnvelope, attachments: IncomingDocument[], actor: string,
  clock: Clock = systemClock, email?: IncomingEmail | null): { state: RunState; documentIds: number[] } {
  const documentIds: number[] = [];
  const next = act(state, clock, (r) => {
    const envelopeId = r.nextId(r.s.envelopes);
    r.s.envelopes.push({ id: envelopeId, ...envelope, receivedAt: envelope.receivedAt || r.now(), createdAt: r.now(),
      ...(email ? { bodyText: email.bodyText, attachments: email.seen } : {}) });
    r.audit("envelope", envelopeId, "received", actor, { intake_mode: envelope.intakeMode, attachments: attachments.length,
      ...(email ? { evidence_only: email.seen.filter((a) => a.handling === "evidence_only").length } : {}) });
    for (const att of attachments) {
      const original = r.s.documents.filter((d) => d.sha256 === att.sha256 && d.duplicateOf === null)
        .sort((a, b) => a.id - b.id)[0];
      const id = r.nextId(r.s.documents);
      const ts = r.now();
      r.s.documents.push({
        id, envelopeId, originalFilename: att.originalFilename, sha256: att.sha256, sizeBytes: att.sizeBytes,
        pageCount: att.pageCount, pageText: att.pageText, status: original ? "duplicate" : "received",
        statusDetail: original ? `Identical to document ${original.id}` : null, duplicateOf: original?.id ?? null,
        createdAt: ts, updatedAt: ts, ...(att.kind ? { kind: att.kind } : {}),
      });
      r.audit("document", id, "received", actor,
        { envelope_id: envelopeId, sha256: att.sha256, duplicate_of: original?.id ?? null });
      documentIds.push(id);
    }
  });
  return { state: next, documentIds };
}

/** pipeline._set_status: extraction-side status, with an optional detail line shown to the user. */
function extractionStatus(r: Run, docId: number, status: SourceDocument["status"], detail: string | null = null,
  auditDetail?: Detail) {
  const d = r.doc(docId);
  d.status = status;
  d.statusDetail = detail;
  d.updatedAt = r.now();
  r.audit("document", docId, status, SYSTEM, auditDetail ?? (detail ? { detail } : {}));
}

export function startExtraction(state: RunState, docId: number, clock: Clock = systemClock): RunState {
  return act(state, clock, (r) => {
    const d = r.doc(docId);
    if (d.status !== "received" && d.status !== "extracting") throw new Conflict("Document is not waiting for extraction");
    extractionStatus(r, docId, "extracting");
  });
}

export type ExtractionFailure = "unsupported" | "extraction_unavailable" | "extraction_failed";
export const EXTRACTION_MESSAGES = {
  unsupported: "No native text found (scanned or image-only PDF). No OCR adapter is configured: the AI reads scans, the test adapter does not.",
  extraction_unavailable: "Extraction unavailable: no LLM credentials configured. Nothing was simulated.",
} as const;

export function failExtraction(state: RunState, docId: number, kind: ExtractionFailure, detail: string,
  clock: Clock = systemClock): RunState {
  return act(state, clock, (r) => extractionStatus(r, docId, kind, detail));
}

/** D62: whether the reader found a purchase order. Absent = an order (runs and callers before D62). */
export interface Classification { result: "order" | "not_order"; reason: string }

/** pipeline.process_document success path, then workflow.process_after_extraction. D62: a document the reader
 *  classed as not an order keeps its reading but makes no order; a person can correct that (treatAsOrder). */
export function recordExtraction(state: RunState, docId: number, payload: OrderVersion["payload"],
  clock: Clock = systemClock, classification?: Classification | null): RunState {
  return act(state, clock, (r) => {
    if (r.doc(docId).status !== "extracting") throw new Conflict("Document is not being extracted");
    r.s.versions.push({
      id: r.nextId(r.s.versions), documentId: docId, version: 1, origin: "extraction",
      extractor: payload.extractor.name, payload, createdBy: SYSTEM, createdAt: r.now(),
    });
    const d = r.doc(docId);
    d.updatedAt = r.now();
    if (classification) {
      d.classification = { ...classification, by: payload.extractor.name, at: r.now(), correctedBy: null, correctedAt: null };
    }
    if (classification?.result === "not_order") {
      d.status = "not_order";
      d.statusDetail = classification.reason;
      r.audit("document", docId, "classified_not_order", SYSTEM, { extractor: payload.extractor.name,
        is_ai: payload.extractor.is_ai, reason: classification.reason });
      return;
    }
    d.status = "extracted";
    d.statusDetail = null;
    r.audit("document", docId, "extracted", SYSTEM,
      { extractor: payload.extractor.name, is_ai: payload.extractor.is_ai, lines: payload.lines.length });
    processAfterExtraction(r, docId);
  });
}

/** D62: a person corrects a false "Not an order". The reading already made is checked like any other order. */
export function treatAsOrder(state: RunState, docId: number, who: Who, clock: Clock = systemClock): RunState {
  requireReviewer(who.role);
  return act(state, clock, (r) => {
    const d = r.doc(docId);
    if (d.status !== "not_order") throw new Conflict("Only a message classed as not an order can be corrected");
    if (!r.latestVersion(docId)) throw new Conflict("Nothing was read from this message");
    d.classification = { ...(d.classification ?? { result: "not_order", reason: "", by: SYSTEM, at: r.now() }),
      result: "order", correctedBy: who.actor, correctedAt: r.now() };
    d.status = "extracted";
    d.statusDetail = null;
    d.updatedAt = r.now();
    r.audit("document", docId, "classification_corrected", who.actor, { to: "order" });
    processAfterExtraction(r, docId);
  });
}

export function retryExtraction(state: RunState, docId: number, who: Who, clock: Clock = systemClock): RunState {
  return act(state, clock, (r) => {
    const d = r.doc(docId);
    if (d.status !== "extraction_failed" && d.status !== "extraction_unavailable") {
      throw new Conflict("Only failed or unavailable extraction can be retried");
    }
    d.status = "received";
    d.statusDetail = null;
    d.updatedAt = r.now();
    r.audit("document", docId, "extraction_retry_requested", who.actor, {});
  });
}

// ---------- evaluation ----------

function overrides(r: Run, docId: number): Overrides {
  const out: Overrides = {};
  for (const d of r.decisionsFor(docId)) {
    const p = d.params;
    if (d.action === "map_item") {
      out[d.issueKey] = { sku: p.sku, text: `Mapped to ${p.sku} by ${nameOf(d.actor)} (decision #${d.id})` };
    } else if (d.action === "apply_mapping") {
      out[d.issueKey] = {
        replacement_sku: p.replacement_sku,
        text: `Mapping ${p.obsolete_identifier} -> ${p.replacement_identifier} approved by ${nameOf(d.actor)} ` +
          `for this order (decision #${d.id})`,
      };
    } else if (LINE_EDIT_ACTIONS.has(d.action)) {
      const key = `edit:${p.line_index}`;
      out[key] = out[key] ?? {};
      out[key][d.action === "change_quantity" ? "quantity" : "unit_price"] = p.value ?? null;
    }
  }
  return out;
}

/** Run matching + validation on the current version and store the result. Pure recomputation. */
function evaluate(r: Run, docId: number): ValidationResult {
  const ver = r.latestVersion(docId);
  const others = r.s.orders.filter((o) => o.documentId < docId && o.reviewState !== "rejected")
    .sort((a, b) => a.documentId - b.documentId)
    .map((o) => ({ document_id: o.documentId, customer_id: o.customerId, po_number: o.poNumber }));
  const existing = r.order(docId);
  // Memory rules are applied at first validation; activation affects future orders, not this one.
  const rules = existing ? existing.validation.rules_snapshot
    : r.s.memoryRules.filter((m) => m.state === "active").sort((a, b) => a.id - b.id).map(ruleRow);
  const out = validate(structuredClone(ver.payload), r.reference(), structuredClone(rules), overrides(r, docId), others);
  // D63, D65: checks on top of the parity port (dates, email vs attachment, value on the wrong line, ship-to choices).
  const doc = r.doc(docId);
  const env = r.s.envelopes.find((e) => e.id === doc.envelopeId);
  applyChecks(out as never, { payload: ver.payload, pages: doc.pageText, kind: doc.kind ?? "pdf", reference: r.reference(),
    decisions: r.decisionsFor(docId),
    email: env && (env.bodyText || env.subjectMetadata) ? { subject: env.subjectMetadata, bodyText: env.bodyText ?? null } : null });
  const resolved = new Map<string, Decision>();
  for (const d of r.decisionsFor(docId)) resolved.set(JSON.stringify([d.issueKey, d.fingerprint ?? ""]), d);
  for (const issue of out.issues) {
    const hit = resolved.get(JSON.stringify([issue.key, issue.fingerprint]));
    issue.status = hit ? "resolved" : "open";
    issue.resolution = hit ? { decision_id: hit.id, action: hit.action, actor: hit.actor, role: hit.role,
      reason: hit.reason, at: hit.createdAt } : null;
  }
  const result = { ...out, rules_snapshot: rules, version: ver.version } as unknown as ValidationResult;
  const order = out.order as { customer_id: string | null; po_number: string | null };
  if (existing === undefined) {
    r.s.orders.push({
      documentId: docId, customerId: order.customer_id, poNumber: order.po_number, currentVersion: ver.version,
      reviewState: "validating", deliveryState: "not_started", erpOrderId: null, validation: result, updatedAt: r.now(),
    });
  } else {
    existing.currentVersion = ver.version;
    existing.validation = result;
    existing.updatedAt = r.now();
  }
  return result;
}

export const openBlocking = (result: ValidationResult): Issue[] =>
  result.issues.filter((i) => i.blocking && i.status === "open");

function processAfterExtraction(r: Run, docId: number) {
  r.status(docId, "matching");
  r.status(docId, "validating");
  const result = evaluate(r, docId);
  for (const line of result.order.lines) {
    if (line.resolved_by && line.resolved_by.type === "memory_rule") {
      r.audit("document", docId, "memory_rule_applied", SYSTEM, line.resolved_by as unknown as Detail);
    }
  }
  settle(r, docId);
}

/** Move an order to its next state after any change: needs review, ready, approved, then delivery. */
function settle(r: Run, docId: number) {
  let deliverNow = false;
  const order = r.order(docId);
  if (!order || ["rejected", "awaiting_customer", "amendment_held", "on_hold"].includes(order.reviewState)) return;
  const blocking = openBlocking(order.validation);
  const version = order.currentVersion;
  if (r.validApproval(docId, version)) {
    deliverNow = order.deliveryState === "not_started";
  } else if (blocking.length) {
    if (order.reviewState !== "needs_review") {
      order.reviewState = "needs_review";
      r.status(docId, "needs_review", { open_issues: blocking.map((i) => i.code) });
      // D75: the test environment sends no email; it records that a notification would have gone out.
      if (r.s.settings.notifyOnReview !== false) r.audit("document", docId, "review_notification_sent", "system:notifications", { channel: "email (test)" });
    }
  } else {
    const policy = effectivePolicy(r.s, docId);
    // D46: an order a reviewer onboarded a customer or product for waits for an explicit approval.
    const onboarded = r.s.audit.some((a) => a.entityType === "document" && a.entityId === docId
      && a.event.startsWith("reference_"));
    // D59: a scan was read from images, so a person checks it against the page before it goes anywhere.
    const scanned = r.s.versions.find((v) => v.documentId === docId && v.version === version)?.payload.source === "scan";
    if (policy.mode === "exception_only" && r.decisionsFor(docId).length === 0 && !onboarded && !scanned) {
      approveVersion(r, docId, version, "system", `policy:exception_only#${policy.id}`, policy);
      deliverNow = true;
    } else if (order.reviewState !== "ready") {
      order.reviewState = "ready";
      r.status(docId, "ready_for_approval", { policy: policy.mode });
    }
  }
  if (deliverNow) deliver(r, docId);
}

function approveVersion(r: Run, docId: number, version: number, kind: Approval["kind"], actor: string,
  policy: PolicyChange) {
  r.s.approvals.push({
    id: r.nextId(r.s.approvals), documentId: docId, version, kind, actor, policyMode: policy.mode,
    policyVersion: policy.id, createdAt: r.now(), invalidatedAt: null, invalidatedReason: null,
  });
  r.order(docId)!.reviewState = "approved";
  r.status(docId, "approved", { kind, actor, version, policy: policy.mode, policy_version: policy.id });
}

// ---------- reviewer actions ----------

function newVersion(r: Run, docId: number, actor: string, decisionId: number): number {
  const latest = r.latestVersion(docId);
  const payload = structuredClone(latest.payload);
  payload.applied_decisions = [...(payload.applied_decisions ?? []), decisionId];
  const version = latest.version + 1;
  r.s.versions.push({
    id: r.nextId(r.s.versions), documentId: docId, version, origin: "review", extractor: latest.extractor,
    payload, createdBy: actor, createdAt: r.now(),
  });
  for (const a of r.s.approvals.filter((x) => x.documentId === docId && x.invalidatedAt === null)) {
    a.invalidatedAt = r.now();
    a.invalidatedReason = `superseded by version ${version}`;
    r.audit("document", docId, "approval_invalidated", actor, { approval_id: a.id, new_version: version });
  }
  return version;
}

export interface DecisionInput {
  issueKey: string;
  action: Decision["action"];
  params?: { sku?: string; save_for_future?: boolean; value?: string; note?: string; date?: string; ship_to_id?: string;
    reason_code?: string };
  reason?: string | null;
}

export function decide(state: RunState, docId: number, input: DecisionInput, who: Who,
  clock: Clock = systemClock): RunState {
  requireReviewer(who.role);
  return act(state, clock, (r) => {
    const { issueKey, action } = input;
    const params = input.params ?? {};
    const reason = input.reason ?? null;
    const order = r.order(docId);
    if (!order) throw new Conflict("Order has not been validated");
    if (order.deliveryState !== "not_started" && order.deliveryState !== "failed") {
      if (LINE_EDIT_ACTIONS.has(action)) { holdAmendment(r, docId, who.actor, action, params); return; }
      throw new Conflict("Order was already delivered; changes are held as amendments");
    }
    const result = order.validation;
    let issue: { key: string; fingerprint: string | null; code: string; actions: string[]; line_index: number | null;
      proposal?: Issue["proposal"]; evidence?: string | null };
    if (LINE_EDIT_ACTIONS.has(action) && issueKey.startsWith("edit:")) {
      const index = issueKey.slice("edit:".length);
      if (!/^\d+$/.test(index)) throw new Conflict("Unknown line");
      issue = { key: issueKey, fingerprint: null, code: "edit", actions: [...LINE_EDIT_ACTIONS],
        line_index: Number.parseInt(index, 10), proposal: null };
    } else {
      const found = result.issues.find((i) => i.key === issueKey && i.status === "open");
      if (!found) throw new Conflict("No open issue with that key");
      issue = found;
    }
    if (!issue.actions.includes(action)
      && !(LINE_EDIT_ACTIONS.has(action) && ["moq_violation", "price_mismatch"].includes(issue.code))) {
      throw new Conflict(`Action ${action} is not allowed for ${issue.code}`);
    }
    if (REASON_REQUIRED.has(action) && !reason) throw new Conflict("A reason is required for this decision");
    let stored: Decision["params"] = {};
    if (action === "map_item") {
      const sku = params.sku;
      if (!sku || !r.reference().products.some((p) => p.sku === sku)) throw new Conflict("Unknown SKU");
      stored = { sku };
    } else if (action === "apply_mapping") {
      const proposal = issue.proposal;
      if (!proposal) throw new Conflict("No proposed mapping exists for this identifier");
      stored = { obsolete_identifier: proposal.obsolete_identifier, replacement_identifier: proposal.replacement_identifier,
        replacement_sku: proposal.replacement_sku, save_for_future: Boolean(params.save_for_future) };
    } else if (LINE_EDIT_ACTIONS.has(action)) {
      const value = dec(params.value);
      if (value === null || !dec("0")!.lt(value)) throw new Conflict("A positive decimal value is required");
      stored = { line_index: issue.line_index!, value: value.toString(), authorised_by: who.actor };
    } else if (action === "request_customer_correction") {
      stored = { note: params.note || "Customer asked to correct the order" };
    } else if (action === "choose_date") {
      const date = params.date ?? "";
      const found = issue as Issue;
      const options = found.candidate_dates;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new Conflict("Choose a date (YYYY-MM-DD)");
      if (options?.length && !options.includes(date)) throw new Conflict("Choose one of the dates the printed value can mean");
      stored = { date, field: found.field };
    } else if (action === "choose_ship_to") {
      const options = (issue as Issue).candidate_ship_tos ?? [];
      if (!params.ship_to_id || !options.includes(params.ship_to_id)) throw new Conflict("Choose a ship-to on file for this customer");
      stored = { ship_to_id: params.ship_to_id };
    } else if (action === "reject_order" && params.reason_code) {
      stored = { reason_code: RejectReason.parse(params.reason_code) };
    }
    const decisionId = r.nextId(r.s.decisions);
    const decision: Decision = { id: decisionId, documentId: docId, issueKey, fingerprint: issue.fingerprint, action,
      params: stored, reason, actor: who.actor, role: who.role as Decision["role"], versionCreated: null,
      createdAt: r.now() };
    r.s.decisions.push(decision);
    const version = newVersion(r, docId, who.actor, decisionId);
    decision.versionCreated = version;
    r.audit("document", docId, "decision_recorded", who.actor, { decision_id: decisionId, issue: issueKey, action,
      reason, role: who.role, version, ...stored });
    if (action === "reject_order") {
      order.reviewState = "rejected";
      r.status(docId, "rejected", { actor: who.actor, reason, reason_code: stored.reason_code ?? null });
    } else if (action === "request_customer_correction") {
      order.reviewState = "awaiting_customer";
      r.status(docId, "awaiting_customer", { actor: who.actor });
    }
    if (action === "apply_mapping" && stored.save_for_future) saveCandidate(r, docId, decisionId, stored, who.actor, issue);
    const after = evaluate(r, docId);
    // Approving the final exception is the reviewer's approval of this exact version (no Send click).
    if (!openBlocking(after).length && !["rejected", "awaiting_customer"].includes(r.order(docId)!.reviewState)) {
      approveVersion(r, docId, version, "human", who.actor, effectivePolicy(r.s, docId));
    }
    settle(r, docId);
  });
}

/** Explicit approval of a clean order (Review-all mode). Delivery then starts automatically. */
export function approve(state: RunState, docId: number, who: Who, clock: Clock = systemClock): RunState {
  requireReviewer(who.role);
  return act(state, clock, (r) => {
    const order = r.order(docId);
    if (!order || order.reviewState !== "ready") throw new Conflict("Only a validated order with no open issues can be approved");
    approveVersion(r, docId, order.currentVersion, "human", who.actor, effectivePolicy(r.s, docId));
    settle(r, docId);
  });
}

/** D64: states in which a person can still hold or reject the whole order (nothing has gone to the ERP). */
function beforeErp(order: Order) {
  return order.deliveryState === "not_started" || order.deliveryState === "failed";
}

/** D64: an internal hold. The order stops where it is until a person releases it; nothing is sent meanwhile.
 *  Separate from "Waiting on customer", which records that the customer was asked to correct the order. */
export function holdOrder(state: RunState, docId: number, reason: string, who: Who, clock: Clock = systemClock): RunState {
  requireReviewer(who.role);
  const code = HoldReason.safeParse(reason);
  if (!code.success) throw new Conflict("Choose a hold reason");
  return act(state, clock, (r) => {
    const order = r.order(docId);
    if (!order) throw new Conflict("Order has not been validated");
    if (!beforeErp(order)) throw new Conflict("The order is already in the ERP; hold it there");
    if (["rejected", "on_hold"].includes(order.reviewState)) throw new Conflict("The order is already rejected or on hold");
    for (const a of r.s.approvals.filter((x) => x.documentId === docId && x.invalidatedAt === null)) {
      a.invalidatedAt = r.now();
      a.invalidatedReason = "order put on hold";
    }
    r.s.holds = r.s.holds ?? [];
    r.s.holds.push({ id: r.nextId(r.s.holds), documentId: docId, reason: code.data, heldBy: who.actor, heldAt: r.now(),
      releasedBy: null, releasedAt: null });
    order.reviewState = "on_hold";
    r.status(docId, "on_hold", { actor: who.actor, reason_code: code.data });
  });
}

export function releaseHold(state: RunState, docId: number, who: Who, clock: Clock = systemClock): RunState {
  requireReviewer(who.role);
  return act(state, clock, (r) => {
    const order = r.order(docId);
    const hold = (r.s.holds ?? []).find((h) => h.documentId === docId && h.releasedAt === null);
    if (!order || order.reviewState !== "on_hold" || !hold) throw new Conflict("The order is not on hold");
    Object.assign(hold, { releasedBy: who.actor, releasedAt: r.now() });
    order.reviewState = "validating";
    r.audit("document", docId, "hold_released", who.actor, { hold_id: hold.id });
    evaluate(r, docId);
    settle(r, docId);
  });
}

/** D64: reject the whole order, with an optional short reason choice (no typed explanation is required). */
export function rejectOrder(state: RunState, docId: number, reasonCode: string | null, who: Who, clock: Clock = systemClock): RunState {
  requireReviewer(who.role);
  const code = reasonCode ? RejectReason.safeParse(reasonCode) : null;
  if (code && !code.success) throw new Conflict("Unknown reject reason");
  return act(state, clock, (r) => {
    const order = r.order(docId);
    if (!order) throw new Conflict("Order has not been validated");
    if (!beforeErp(order)) throw new Conflict("The order is already in the ERP; cancel it there");
    if (order.reviewState === "rejected") throw new Conflict("The order is already rejected");
    for (const h of (r.s.holds ?? []).filter((x) => x.documentId === docId && x.releasedAt === null)) {
      Object.assign(h, { releasedBy: who.actor, releasedAt: r.now() });
    }
    order.reviewState = "rejected";
    r.status(docId, "rejected", { actor: who.actor, reason_code: code?.data ?? null });
  });
}

function holdAmendment(r: Run, docId: number, actor: string, action: string, params: DecisionInput["params"]) {
  r.order(docId)!.reviewState = "amendment_held";
  r.audit("document", docId, "amendment_held", actor, { action, params: (params ?? {}) as Detail,
    detail: "Order already delivered to ERP; the ERP record is not overwritten. A separate decision is required." });
}

// ---------- session onboarding (D46): add a customer or product from a real PO ----------

export interface CustomerInput { name?: string; currency?: string }
export interface ProductInput { sku?: string; description?: string; moq?: string }

/** The open issue an onboarding action answers, on an order that has not gone to the ERP yet. */
function openIssueFor(r: Run, docId: number, issueKey: string, code: string): Issue {
  const order = r.order(docId);
  if (!order) throw new Conflict("Order has not been validated");
  if (order.deliveryState !== "not_started" && order.deliveryState !== "failed") {
    throw new Conflict("Order was already delivered; reference data cannot be changed for it");
  }
  if (["rejected", "awaiting_customer", "amendment_held"].includes(order.reviewState)) {
    throw new Conflict("This order is not waiting for review");
  }
  const found = order.validation.issues.find((i) => i.key === issueKey && i.status === "open");
  if (!found || found.code !== code) throw new Conflict("No open issue of that kind");
  return found;
}

function overlay(r: Run) {
  r.s.referenceOverlay = r.s.referenceOverlay ?? emptyOverlay();
  return r.s.referenceOverlay;
}

/** Validate this order again against the reference plus the additions, then move it on. */
function revalidate(r: Run, docId: number) {
  const result = evaluate(r, docId);
  r.order(docId)!.customerId = result.order.customer_id; // the customer may now be known
  settle(r, docId);
}

const header = (r: Run, docId: number, key: "customer_id" | "customer_name" | "ship_to_id" | "currency") => {
  const value = r.latestVersion(docId).payload.header[key].value;
  return value && value.trim() ? value.trim() : null;
};

export function addCustomer(state: RunState, docId: number, input: CustomerInput, who: Who,
  clock: Clock = systemClock): RunState {
  requireReviewer(who.role);
  return act(state, clock, (r) => {
    openIssueFor(r, docId, "unknown_customer:H", "unknown_customer");
    const printedId = header(r, docId, "customer_id");
    const printedName = header(r, docId, "customer_name");
    const name = input.name?.trim() || printedName || printedId;
    if (!name) throw new Conflict("Enter a name for the new customer");
    const currency = (input.currency?.trim() || header(r, docId, "currency") || "").toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new Conflict("Enter the customer's currency as a three-letter code, e.g. USD");
    const ref = r.reference();
    const ov = overlay(r);
    let customerId = printedId;
    if (customerId === null) {
      let n = ov.customers.length + 1;
      while (ref.customers.some((c) => c.customer_id === `SESSION-CUST-${String(n).padStart(2, "0")}`)) n++;
      customerId = `SESSION-CUST-${String(n).padStart(2, "0")}`;
    }
    if (ref.customers.some((c) => c.customer_id === customerId)) throw new Conflict("That customer ID is already on file");
    const shipTo = header(r, docId, "ship_to_id");
    const meta = { addedBy: who.actor, addedAt: r.now(), sourceDocumentId: docId };
    ov.customers.push({ customerId, name, currency, shipToIds: shipTo ? [shipTo] : [],
      printedAs: printedId ?? printedName, ...meta });
    // An edited name must still match what this customer prints on later orders.
    if (!printedId && printedName && printedName.toLowerCase() !== name.toLowerCase()) {
      ov.customerAliases.push({ printed: printedName, customerId, ...meta });
    }
    r.audit("document", docId, "reference_customer_added", who.actor, { customer_id: customerId, name, currency,
      ship_to_id: shipTo, printed: printedId ?? printedName, scope: "this session" });
    revalidate(r, docId);
  });
}

export function assignCustomer(state: RunState, docId: number, customerId: string, who: Who,
  clock: Clock = systemClock): RunState {
  requireReviewer(who.role);
  return act(state, clock, (r) => {
    const issue = openIssueFor(r, docId, "unknown_customer:H", "unknown_customer");
    const printed = typeof issue.printed_value === "string" ? issue.printed_value : null;
    if (!printed) throw new Conflict("The PO prints no customer name or ID to assign");
    const customer = r.reference().customers.find((c) => c.customer_id === customerId);
    if (!customer) throw new Conflict("Unknown customer");
    overlay(r).customerAliases.push({ printed, customerId, addedBy: who.actor, addedAt: r.now(), sourceDocumentId: docId });
    r.audit("document", docId, "reference_customer_assigned", who.actor, { printed, customer_id: customerId,
      scope: "this session" });
    revalidate(r, docId);
  });
}

export function addShipTo(state: RunState, docId: number, who: Who, clock: Clock = systemClock): RunState {
  requireReviewer(who.role);
  return act(state, clock, (r) => {
    openIssueFor(r, docId, "unknown_ship_to:H", "unknown_ship_to");
    const customerId = r.order(docId)!.customerId;
    const shipTo = header(r, docId, "ship_to_id");
    if (!customerId || !shipTo) throw new Conflict("The PO prints no ship-to ID to add");
    overlay(r).shipTos.push({ customerId, shipToId: shipTo, addedBy: who.actor, addedAt: r.now(), sourceDocumentId: docId });
    r.audit("document", docId, "reference_ship_to_added", who.actor, { customer_id: customerId, ship_to_id: shipTo,
      scope: "this session" });
    revalidate(r, docId);
  });
}

/** Add the product printed on one line, with the printed unit price as this customer's reference price. */
export function addProduct(state: RunState, docId: number, issueKey: string, input: ProductInput, who: Who,
  clock: Clock = systemClock): RunState {
  requireReviewer(who.role);
  return act(state, clock, (r) => {
    const issue = openIssueFor(r, docId, issueKey, "unknown_item");
    const order = r.order(docId)!;
    const customerId = order.customerId;
    if (!customerId) throw new Conflict("Add or assign the customer first; prices and minimums are per customer");
    const line = order.validation.order.lines[issue.line_index ?? -1];
    if (!line) throw new Conflict("Unknown line");
    const gtin = line.printed_gtin?.trim() || null;
    const itemCode = line.customer_item_code?.trim() || null;
    const identifier = gtin ?? itemCode;
    if (!identifier) throw new Conflict("The line prints no GTIN or item code to add");
    const unit = line.original_unit?.trim();
    if (!unit) throw new Conflict("The line prints no unit");
    const price = dec(line.printed_unit_price);
    if (price === null || !dec("0")!.lt(price)) throw new Conflict("The line's unit price is missing or unreadable");
    const currency = order.validation.order.currency;
    if (!currency) throw new Conflict("The order has no currency");
    const moq = dec(input.moq?.trim() || "1");
    if (moq === null || !dec("0")!.lt(moq)) throw new Conflict("Minimum order quantity must be a positive number");
    const sku = input.sku?.trim() || identifier;
    const ref = r.reference();
    if (ref.products.some((p) => p.sku === sku)) {
      throw new Conflict(`Product ${sku} is already in the catalogue; map the line to it instead`);
    }
    const description = input.description?.trim() || line.description?.trim() || identifier;
    const added = { sku, gtin, customerItemCode: gtin ? null : itemCode, customerId, description, unit,
      price: money(price), currency, moq: qty(moq), addedBy: who.actor, addedAt: r.now(), sourceDocumentId: docId };
    overlay(r).products.push(added);
    r.audit("document", docId, "reference_product_added", who.actor, { sku, gtin, customer_item_code: added.customerItemCode,
      customer_id: customerId, unit, price: added.price, currency, moq: added.moq, line_index: issue.line_index,
      scope: "this session" });
    revalidate(r, docId);
  });
}

// ---------- agent memory ----------

function saveCandidate(r: Run, docId: number, decisionId: number, stored: Decision["params"], actor: string,
  issue: { evidence?: string | null }) {
  const order = r.order(docId)!;
  if (!order.customerId) throw new Conflict("A memory rule needs a known customer");
  const id = r.nextId(r.s.memoryRules);
  r.s.memoryRules.push({
    id, kind: "identifier_mapping", customerId: order.customerId, obsoleteIdentifier: stored.obsolete_identifier!,
    replacementIdentifier: stored.replacement_identifier!, replacementSku: stored.replacement_sku!,
    referenceVersion: r.baseReference().reference_version, state: "candidate", sourceDocumentId: docId,
    sourceDecisionId: decisionId, evidence: issue.evidence ?? null, createdBy: actor, createdAt: r.now(),
    activatedBy: null, activatedAt: null, revokedBy: null, revokedAt: null, revokeReason: null,
  });
  r.audit("memory_rule", id, "rule_candidate_saved", actor, { customer_id: order.customerId,
    from: stored.obsolete_identifier!, to: stored.replacement_identifier!, source_document_id: docId });
}

export function setRuleState(state: RunState, ruleId: number, target: "active" | "revoked", who: Who,
  reason: string | null = null, clock: Clock = systemClock): RunState {
  if (who.role !== "administrator") throw new Forbidden("Only an administrator can activate or revoke memory rules");
  return act(state, clock, (r) => {
    const rule = r.s.memoryRules.find((m) => m.id === ruleId);
    if (!rule) throw new Conflict("Unknown rule");
    if (target === "active" && rule.state !== "candidate") throw new Conflict("Only a candidate can be activated");
    if (target === "revoked" && rule.state === "revoked") throw new Conflict("Rule already revoked");
    if (target === "active") {
      Object.assign(rule, { state: "active", activatedBy: who.actor, activatedAt: r.now() });
    } else {
      Object.assign(rule, { state: "revoked", revokedBy: who.actor, revokedAt: r.now(), revokeReason: reason });
    }
    r.audit("memory_rule", ruleId, `rule_${target}`, who.actor, { reason });
  });
}

// ---------- ERP simulator (in the run; no live ERP) ----------

class ErpFailed extends Error {}
class ErpTimeout extends Error {}

function erpSubmit(r: Run, key: string, payload: RunState["erpOrders"][number]["payload"], updates: string | null = null): string {
  const mode = r.s.settings.erpFailureMode;
  if (mode === "fail_next") {
    r.s.settings.erpFailureMode = "none";
    throw new ErpFailed("ERP simulator rejected the request (simulated outage)");
  }
  let erpId = r.s.erpOrders.find((e) => e.idempotencyKey === key)?.erpOrderId;
  if (!erpId) {
    // D74: an accepted revision updates the order the ERP already holds; it never creates a second one.
    erpId = updates ?? `SIM-ERP-${100001 + r.s.erpOrders.length}`;
    r.s.erpOrders.push({ erpOrderId: erpId, idempotencyKey: key, payload, createdAt: r.now() });
  }
  if (mode === "timeout_next") {
    r.s.settings.erpFailureMode = "none";
    throw new ErpTimeout("No response from ERP simulator after the order was created (simulated timeout)");
  }
  return erpId;
}

const erpLookup = (r: Run, key: string) => r.s.erpOrders.find((e) => e.idempotencyKey === key)?.erpOrderId ?? null;

function deliveryState(r: Run, docId: number, attemptId: number | null, state: DeliveryAttempt["state"],
  detail: string | null, opts: { erpId?: string | null; version?: number; key: string }): number {
  const erpId = opts.erpId ?? null;
  if (attemptId === null) {
    attemptId = r.nextId(r.s.deliveries);
    r.s.deliveries.push({ id: attemptId, documentId: docId, version: opts.version!, idempotencyKey: opts.key, state,
      detail, erpOrderId: null, createdAt: r.now(), updatedAt: r.now() });
  } else {
    const a = r.s.deliveries.find((x) => x.id === attemptId)!;
    Object.assign(a, { state, detail, erpOrderId: erpId, updatedAt: r.now() });
  }
  const order = r.order(docId)!;
  order.deliveryState = state;
  order.erpOrderId = erpId ?? order.erpOrderId;
  r.audit("document", docId, `delivery_${state}`, SYSTEM,
    { attempt_id: attemptId, idempotency_key: opts.key, erp_order_id: erpId, detail });
  return attemptId;
}

/** Automatic delivery after approval. Idempotency key = document hash + approved version (D23). */
function deliver(r: Run, docId: number) {
  const order = r.order(docId)!;
  const approval = r.validApproval(docId, order.currentVersion);
  if (!approval || order.deliveryState === "submitting" || order.deliveryState === "erp_created") return;
  const version = order.currentVersion;
  const key = `${r.doc(docId).sha256.slice(0, 16)}:v${version}`;
  const attempt = deliveryState(r, docId, null, "queued", "Queued automatically after approval", { version, key });
  const existing = erpLookup(r, key); // reconcile before any (re)submission
  if (existing) {
    deliveryState(r, docId, attempt, "erp_created", "Reconciled: ERP already holds this order", { erpId: existing, key });
    confirmOrder(r.s, r.now(), docId); // D45: simulated ORDRSP to the retailer, its own delivery state
    return;
  }
  deliveryState(r, docId, attempt, "submitting", null, { key });
  const payload = { idempotency_key: key, approved_version: version,
    approval: { kind: approval.kind, actor: approval.actor, policy: approval.policyMode },
    order: structuredClone(order.validation.order) };
  const revises = revisedOrder(r, docId);
  let erpId: string;
  try {
    erpId = erpSubmit(r, key, payload, revises?.erpOrderId ?? null);
  } catch (exc) {
    if (exc instanceof ErpFailed) { deliveryState(r, docId, attempt, "failed", exc.message, { key }); return; }
    if (exc instanceof ErpTimeout) { deliveryState(r, docId, attempt, "unknown", exc.message, { key }); return; }
    throw exc;
  }
  deliveryState(r, docId, attempt, "erp_created", revises ? `ERP simulator updated ${erpId} to this revision`
    : "ERP simulator acknowledged the order", { erpId, key });
  if (revises) r.audit("document", docId, "erp_order_revised", SYSTEM, { erp_order_id: erpId, revises_document_id: revises.documentId });
  confirmOrder(r.s, r.now(), docId); // D45: simulated ORDRSP to the retailer, its own delivery state
}

/** The earlier order a person accepted this one as a revision of, when that order is already in the ERP. */
function revisedOrder(r: Run, docId: number): Order | null {
  if (!r.decisionsFor(docId).some((d) => d.action === "accept_as_revision")) return null;
  const me = r.order(docId)!;
  return r.s.orders.filter((o) => o.documentId < docId && o.customerId === me.customerId && o.poNumber === me.poNumber && o.erpOrderId)
    .sort((a, b) => b.documentId - a.documentId)[0] ?? null;
}

export function retryDelivery(state: RunState, docId: number, who: Who, clock: Clock = systemClock): RunState {
  requireReviewer(who.role);
  return act(state, clock, (r) => {
    const order = r.order(docId);
    if (!order || (order.deliveryState !== "failed" && order.deliveryState !== "unknown")) {
      throw new Conflict("Only failed or unknown deliveries can be retried");
    }
    order.deliveryState = "not_started";
    r.audit("document", docId, "delivery_retry_requested", who.actor, {});
    deliver(r, docId);
  });
}

/** workflow.recover_deliveries: when a saved run is reopened, reconcile any delivery left queued, submitting
 *  or unknown. Reconciliation finds an ERP record created before the interruption instead of making another. */
export function recoverDeliveries(state: RunState, clock: Clock = systemClock): RunState {
  return act(state, clock, (r) => {
    const ids = r.s.orders.filter((o) => ["queued", "submitting", "unknown"].includes(o.deliveryState))
      .map((o) => o.documentId);
    for (const id of ids) r.order(id)!.deliveryState = "not_started";
    for (const id of ids) deliver(r, id);
  });
}

// ---------- administration ----------

/** D64: the policy for this order: its retailer's setting for the route it came by, else the default. */
export function effectivePolicy(s: RunState, docId: number): PolicyChange {
  const order = s.orders.find((o) => o.documentId === docId);
  const channel = channelOf(s, docId);
  const own = order?.customerId
    ? [...s.policyHistory].reverse().find((p) => p.customerId === order.customerId && p.channel === channel) : undefined;
  return own ?? [...s.policyHistory].reverse().find((p) => !p.customerId)!;
}

const MIN_REASON = 3;
/** The default for routes with no setting of their own. D64: automatic needs an administrator and a reason. */
export function setPolicy(state: RunState, mode: string, who: Who, clock: Clock = systemClock, reason: string | null = null): RunState {
  if (who.role !== "administrator") throw new Forbidden("Only an administrator can change the automation mode");
  if (mode !== "review_all" && mode !== "exception_only") throw new Conflict("Unknown mode");
  const why = reason?.trim() ?? "";
  if (mode === "exception_only" && why.length < MIN_REASON) throw new Conflict("Enter the reason for automatic processing");
  return act(state, clock, (r) => {
    const id = r.nextId(r.s.policyHistory);
    r.s.policyHistory.push({ id, mode, setBy: who.actor, effectiveAt: r.now(), ...(why ? { reason: why } : {}) });
    r.audit("policy", id, "policy_changed", who.actor, { mode, ...(why ? { reason: why } : {}) });
  });
}

/** D64: supervision for one retailer's orders on one route. New routes stay supervised until an administrator
 *  switches this on with a reason; blocking issues stop an order in either mode. */
export function setRoutePolicy(state: RunState, customerId: string, channel: Channel, mode: string, reason: string | null,
  who: Who, clock: Clock = systemClock): RunState {
  if (who.role !== "administrator") throw new Forbidden("Only an administrator can change supervision");
  if (mode !== "review_all" && mode !== "exception_only") throw new Conflict("Unknown mode");
  const why = reason?.trim() ?? "";
  if (mode === "exception_only" && why.length < MIN_REASON) throw new Conflict("Enter the reason for automatic processing");
  return act(state, clock, (r) => {
    const id = r.nextId(r.s.policyHistory);
    r.s.policyHistory.push({ id, mode, setBy: who.actor, effectiveAt: r.now(), customerId, channel, ...(why ? { reason: why } : {}) });
    r.audit("policy", id, "route_policy_changed", who.actor, { customer_id: customerId, channel, mode, ...(why ? { reason: why } : {}) });
  });
}

const REQUIRED_REFERENCE_KEYS = ["reference_version", "policy_version", "customers", "products", "reference_prices"];

/** Replace reference data with a new version. Affects orders validated from now on, not ERP records. */
export function importReference(state: RunState, data: unknown, who: Who, clock: Clock = systemClock): RunState {
  if (who.role !== "administrator") throw new Forbidden("Only an administrator can import reference data");
  const obj = (typeof data === "object" && data !== null ? data : {}) as Record<string, unknown>;
  const missing = REQUIRED_REFERENCE_KEYS.filter((k) => !(k in obj)).sort();
  if (missing.length) throw new Conflict(`Reference data is missing: ${missing.join(", ")}`);
  const parsed = ReferenceData.safeParse(obj);
  if (!parsed.success) throw new Conflict("Reference data is not in the expected format");
  return act(state, clock, (r) => {
    if (parsed.data.reference_version === r.baseReference().reference_version) {
      throw new Conflict("Reference data must carry a new reference_version");
    }
    r.s.settings.referenceData = parsed.data;
    r.audit("system", 0, "reference_data_imported", who.actor,
      { reference_version: parsed.data.reference_version, policy_version: parsed.data.policy_version });
  });
}

export function setTestSetting(state: RunState, key: "erp_failure_mode" | "test_reader", value: string, who: Who,
  clock: Clock = systemClock): RunState {
  if (who.role !== "administrator") throw new Forbidden("Only an administrator can change demo settings");
  const allowed = key === "erp_failure_mode" ? ["none", "fail_next", "timeout_next"] : ["on", "off"];
  if (!allowed.includes(value)) throw new Conflict(`value must be one of ${[...allowed].sort().join(", ")}`);
  return act(state, clock, (r) => {
    if (key === "erp_failure_mode") r.s.settings.erpFailureMode = value as RunState["settings"]["erpFailureMode"];
    else r.s.settings.testReader = value === "on";
    r.audit("system", 0, "test_setting_changed", who.actor, { key, value });
  });
}

export function setNotifications(state: RunState, enabled: boolean, who: Who, clock: Clock = systemClock): RunState {
  if (who.role !== "administrator") throw new Forbidden("Only an administrator can change notifications");
  return act(state, clock, (r) => {
    r.s.settings.notifyOnReview = enabled;
    r.audit("system", 0, "notifications_changed", who.actor, { notify_on_review: enabled });
  });
}

export function resetTestData(state: RunState, who: Who, clock: Clock = systemClock): RunState {
  if (who.role !== "administrator") throw new Forbidden("Only an administrator can reset the demo");
  return act(emptyRunState(clock.now()), clock, (r) => {
    r.s.policyHistory[0].setBy = who.actor;
    r.s.settings.role = state.settings.role;
    r.audit("system", 0, "test_data_reset", who.actor, {});
  });
}

// ---------- read models ----------

export function memoryRulesWithUses(state: RunState) {
  return [...state.memoryRules].sort((a, b) => a.id - b.id).map((m) => ({
    ...m,
    uses: state.audit.filter((a) => a.event === "memory_rule_applied" && a.detail.rule_id === m.id)
      .map((a) => ({ documentId: a.entityId, createdAt: a.createdAt })),
  }));
}

export function summary(state: RunState) {
  const rows = state.orders;
  return {
    orders_received: state.documents.length,
    delivered_to_erp: rows.filter((o) => o.deliveryState === "erp_created").length,
    auto_approved_by_policy: state.approvals.filter((a) => a.kind === "system" && a.invalidatedAt === null).length,
    held_for_review: rows.filter((o) => ["needs_review", "ready", "awaiting_customer", "amendment_held", "on_hold"]
      .includes(o.reviewState)).length,
    resolved_by_memory: state.audit.filter((a) => a.event === "memory_rule_applied").length,
    delivery_problems: rows.filter((o) => o.deliveryState === "failed" || o.deliveryState === "unknown").length,
  };
}
