// Read models over RunState, in the same JSON shapes the prototype's FastAPI read endpoints returned
// (/api/documents, /api/documents/{id}, /api/orders, /api/memory-rules, /api/erp/orders, /api/policy).
// The screens read these instead of polling a server. Pure functions; nothing here changes the run.
import type { OrderTerms, RunState } from "./run-state";
import { ruleRow } from "./workflow";

export type Field = { value: string | null; page: number | null; evidence: string | null; evidence_verified: boolean; notes: string[] };
export type Policy = { id: number; mode: "review_all" | "exception_only"; set_by: string; effective_at: string };
export type DocSummary = {
  id: number; status: string; status_detail: string | null; original_filename: string | null; duplicate_of: number | null;
  created_at: string; sender: string | null; received_at: string | null; message_id: string | null; intake_mode: string;
  subject_metadata?: string | null;
};
export type Issue = {
  key: string; code: string; title: string; message: string; line_index: number | null;
  printed_value: string | null; reference_value: string | null; reference_version: string | null;
  proposed_action: string | null; evidence: string | null; page: number | null; blocking: boolean;
  actions: string[]; status: "open" | "resolved"; candidate_skus?: string[]; field?: string;
  resolution: null | { decision_id: number; action: string; actor: string; role: string; reason: string | null; at: string };
};
export type Line = {
  line_index: number; source_line_id: string; printed_gtin: string | null; customer_item_code: string | null;
  description: string | null; original_quantity: string | null; original_unit: string | null;
  printed_unit_price: string | null; printed_line_amount: string | null; sku: string | null; gtin: string | null;
  quantity: string | null; unit: string | null; unit_price: string | null; line_amount: string | null;
  resolved_by: null | { type: string; text: string; rule_id?: number }; evidence: string | null; page: number | null;
  edited?: boolean;
};
export type CanonicalOrder = {
  customer_id: string | null; customer_name: string | null; po_number: string | null; currency: string | null;
  ship_to_id: string | null; order_date: string | null; requested_delivery_date: string | null; lines: Line[];
  totals: Record<string, string | null>; reference_version: string; policy_version: string;
};
export type Order = {
  document_id: number; customer_id: string | null; po_number: string | null; current_version: number;
  review_state: string; delivery_state: string; erp_order_id: string | null; updated_at: string;
  validation: { version: number; issues: Issue[]; order: CanonicalOrder };
  approvals: { id: number; document_id: number; version: number; kind: string; actor: string; policy_mode: string;
    policy_version: number; created_at: string; invalidated_at: string | null; invalidated_reason: string | null }[];
  decisions: { id: number; document_id: number; issue_key: string; fingerprint: string | null; action: string;
    params: Record<string, unknown>; reason: string | null; actor: string; role: string; created_at: string; version_created: number | null }[];
  deliveries: { id: number; document_id: number; version: number; idempotency_key: string; state: string; detail: string | null;
    erp_order_id: string | null; created_at: string; updated_at: string }[];
  erp_record?: ErpOrder | null;
};
export type DocDetail = {
  document: Omit<DocSummary, "sender" | "received_at" | "message_id" | "intake_mode" | "subject_metadata">
    & { sha256: string; page_count: number | null; envelope_id: number; size_bytes: number; updated_at: string };
  envelope: { id: number; message_id: string | null; sender: string | null; received_at: string | null; subject_metadata: string | null;
    intake_mode: string; raw_sha256: string | null; created_at: string };
  latest_version: null | { id: number; document_id: number; version: number; origin: string; extractor: string | null; created_by: string;
    created_at: string; payload: { extractor: { name: string; is_ai: boolean }; header: Record<string, Field>; lines: Record<string, Field>[];
      terms?: OrderTerms; source?: "text" | "scan" } };
  timeline: { event: string; actor: string; created_at: string; detail: Record<string, unknown> }[];
  order: Order | null;
  /** Native PDF text per page (was /api/documents/{id}/text). */
  pages: string[];
};
export type Rule = {
  id: number; kind: string; customer_id: string; obsolete_identifier: string; replacement_identifier: string;
  replacement_sku: string; reference_version: string; state: "candidate" | "active" | "revoked";
  source_document_id: number; source_decision_id: number; evidence: string | null; created_by: string; created_at: string;
  activated_by: string | null; activated_at: string | null; revoked_by: string | null; revoked_at: string | null;
  revoke_reason: string | null; uses: { document_id: number; created_at: string }[];
};
export type ErpOrder = { erp_order_id: string; idempotency_key: string; created_at: string;
  payload: { order: CanonicalOrder; approval: { kind: string; actor: string; policy: string }; approved_version: number; idempotency_key: string } };

const byIdDesc = <T extends { id: number }>(rows: T[]) => [...rows].sort((a, b) => b.id - a.id);

export function currentPolicy(s: RunState): Policy {
  const p = s.policyHistory.reduce((a, b) => (b.id > a.id ? b : a));
  return { id: p.id, mode: p.mode, set_by: p.setBy, effective_at: p.effectiveAt };
}

export function documentsList(s: RunState): DocSummary[] {
  return byIdDesc(s.documents).map((d) => {
    const e = s.envelopes.find((x) => x.id === d.envelopeId)!;
    return { id: d.id, status: d.status, status_detail: d.statusDetail, original_filename: d.originalFilename,
      duplicate_of: d.duplicateOf, created_at: d.createdAt, sender: e.sender, received_at: e.receivedAt,
      message_id: e.messageId, intake_mode: e.intakeMode, subject_metadata: e.subjectMetadata };
  });
}

function erpRecord(s: RunState, erpOrderId: string): ErpOrder | null {
  const e = s.erpOrders.find((x) => x.erpOrderId === erpOrderId);
  return e ? { erp_order_id: e.erpOrderId, idempotency_key: e.idempotencyKey, created_at: e.createdAt,
    payload: e.payload as unknown as ErpOrder["payload"] } : null;
}

/** workflow.get_state */
export function orderState(s: RunState, docId: number): Order | null {
  const o = s.orders.find((x) => x.documentId === docId);
  if (!o) return null;
  const { rules_snapshot: _drop, ...validation } = o.validation;
  const out: Order = {
    document_id: o.documentId, customer_id: o.customerId, po_number: o.poNumber, current_version: o.currentVersion,
    review_state: o.reviewState, delivery_state: o.deliveryState, erp_order_id: o.erpOrderId, updated_at: o.updatedAt,
    validation: validation as unknown as Order["validation"],
    approvals: s.approvals.filter((a) => a.documentId === docId).sort((a, b) => a.id - b.id).map((a) => ({
      id: a.id, document_id: a.documentId, version: a.version, kind: a.kind, actor: a.actor, policy_mode: a.policyMode,
      policy_version: a.policyVersion, created_at: a.createdAt, invalidated_at: a.invalidatedAt, invalidated_reason: a.invalidatedReason })),
    decisions: s.decisions.filter((d) => d.documentId === docId).sort((a, b) => a.id - b.id).map((d) => ({
      id: d.id, document_id: d.documentId, issue_key: d.issueKey, fingerprint: d.fingerprint, action: d.action,
      params: d.params as Record<string, unknown>, reason: d.reason, actor: d.actor, role: d.role, created_at: d.createdAt,
      version_created: d.versionCreated })),
    deliveries: s.deliveries.filter((d) => d.documentId === docId).sort((a, b) => a.id - b.id).map((d) => ({
      id: d.id, document_id: d.documentId, version: d.version, idempotency_key: d.idempotencyKey, state: d.state,
      detail: d.detail, erp_order_id: d.erpOrderId, created_at: d.createdAt, updated_at: d.updatedAt })),
  };
  if (o.erpOrderId) out.erp_record = erpRecord(s, o.erpOrderId);
  return out;
}

export function documentDetail(s: RunState, docId: number): DocDetail | null {
  const d = s.documents.find((x) => x.id === docId);
  if (!d) return null;
  const e = s.envelopes.find((x) => x.id === d.envelopeId)!;
  const v = s.versions.filter((x) => x.documentId === docId).sort((a, b) => b.version - a.version)[0];
  return {
    document: { id: d.id, envelope_id: d.envelopeId, original_filename: d.originalFilename, sha256: d.sha256,
      size_bytes: d.sizeBytes, page_count: d.pageCount, status: d.status, status_detail: d.statusDetail,
      duplicate_of: d.duplicateOf, created_at: d.createdAt, updated_at: d.updatedAt },
    envelope: { id: e.id, message_id: e.messageId, sender: e.sender, received_at: e.receivedAt,
      subject_metadata: e.subjectMetadata, intake_mode: e.intakeMode, raw_sha256: e.rawSha256, created_at: e.createdAt },
    latest_version: v ? { id: v.id, document_id: v.documentId, version: v.version, origin: v.origin, extractor: v.extractor,
      created_by: v.createdBy, created_at: v.createdAt, payload: v.payload as unknown as NonNullable<DocDetail["latest_version"]>["payload"] } : null,
    timeline: s.audit.filter((a) => a.entityType === "document" && a.entityId === docId).sort((a, b) => a.id - b.id)
      .map((a) => ({ event: a.event, actor: a.actor, created_at: a.createdAt, detail: a.detail as Record<string, unknown> })),
    order: orderState(s, docId),
    pages: d.pageText,
  };
}

export const ordersList = (s: RunState): Order[] =>
  [...s.orders].sort((a, b) => b.documentId - a.documentId).map((o) => orderState(s, o.documentId)!);

/** workflow.list_rules: every rule with the orders it resolved. */
export const rulesList = (s: RunState): Rule[] =>
  [...s.memoryRules].sort((a, b) => a.id - b.id).map((m) => ({
    ...(ruleRow(m) as Omit<Rule, "uses">),
    uses: s.audit.filter((a) => a.event === "memory_rule_applied" && a.detail.rule_id === m.id)
      .sort((a, b) => a.id - b.id).map((a) => ({ document_id: a.entityId, created_at: a.createdAt })),
  }));

export const erpOrdersList = (s: RunState): ErpOrder[] =>
  [...s.erpOrders].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((e) => erpRecord(s, e.erpOrderId)!);
