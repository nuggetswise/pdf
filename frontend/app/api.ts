export type Field = { value: string | null; page: number | null; evidence: string | null; evidence_verified: boolean; notes: string[] };
export type Policy = { id: number; mode: "review_all" | "exception_only"; set_by: string; effective_at: string };
export type Health = {
  status: string; extraction: string; extractor_mode: string; model: string | null; erp: string;
  rehearsal_mode: boolean; erp_failure_mode: string; policy: Policy;
};
export type DocSummary = {
  id: number; status: string; status_detail: string | null; original_filename: string | null; duplicate_of: number | null;
  created_at: string; sender: string | null; received_at: string | null; message_id: string | null; intake_mode: string;
  subject_metadata?: string | null;
};
export type Issue = {
  key: string; code: string; title: string; message: string; line_index: number | null;
  printed_value: string | null; reference_value: string | null; reference_version: string | null;
  proposed_action: string | null; evidence: string | null; page: number | null; blocking: boolean;
  actions: string[]; status: "open" | "resolved"; candidate_skus?: string[];
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
export type Order = {
  document_id: number; customer_id: string | null; po_number: string | null; current_version: number;
  review_state: string; delivery_state: string; erp_order_id: string | null;
  validation: {
    version: number; issues: Issue[];
    order: {
      customer_id: string | null; customer_name: string | null; po_number: string | null; currency: string | null;
      ship_to_id: string | null; order_date: string | null; requested_delivery_date: string | null; lines: Line[];
      totals: Record<string, string | null>; reference_version: string; policy_version: string;
    };
  };
  approvals: { id: number; version: number; kind: string; actor: string; policy_mode: string; created_at: string; invalidated_at: string | null }[];
  decisions: { id: number; issue_key: string; action: string; reason: string | null; actor: string; role: string; created_at: string; version_created: number }[];
  deliveries: { id: number; version: number; idempotency_key: string; state: string; detail: string | null; erp_order_id: string | null; created_at: string; updated_at: string }[];
  erp_record?: { erp_order_id: string; idempotency_key: string; created_at: string; payload: Record<string, unknown> } | null;
};
export type DocDetail = {
  document: DocSummary & { sha256: string; page_count: number; envelope_id: number };
  envelope: { message_id: string | null; sender: string | null; received_at: string | null; subject_metadata: string | null; intake_mode: string };
  latest_version: null | { version: number; extractor: string; payload: { extractor: { name: string; is_ai: boolean }; header: Record<string, Field>; lines: Record<string, Field>[] } };
  timeline: { event: string; actor: string; created_at: string; detail: Record<string, unknown> }[];
  order: Order | null;
};
export type Rule = {
  id: number; kind: string; customer_id: string; obsolete_identifier: string; replacement_identifier: string;
  replacement_sku: string; reference_version: string; state: "candidate" | "active" | "revoked";
  source_document_id: number; source_decision_id: number; evidence: string | null; created_by: string; created_at: string;
  activated_by: string | null; activated_at: string | null; revoked_by: string | null; revoked_at: string | null;
  revoke_reason: string | null; uses: { document_id: number; created_at: string }[];
};
export type ErpOrder = { erp_order_id: string; idempotency_key: string; created_at: string; payload: { order: Order["validation"]["order"]; approval: { kind: string; actor: string; policy: string }; approved_version: number } };
export type Summary = {
  orders_received: number; delivered_to_erp: number; auto_approved_by_policy: number; held_for_review: number;
  resolved_by_memory: number; delivery_problems: number;
};

/** Demo-only identity: the role travels as a request header. Not real authentication. */
export type Role = "reviewer" | "administrator" | "viewer";
export const PEOPLE: Record<Role, string> = { reviewer: "Rita (demo reviewer)", administrator: "Alex (demo administrator)", viewer: "Viewer" };
const USER: Record<Role, string> = { reviewer: "rita", administrator: "alex", viewer: "viewer" };

export async function api<T>(path: string, init?: RequestInit & { role?: Role; json?: unknown }): Promise<T> {
  const headers: Record<string, string> = {};
  if (init?.role) {
    headers["X-Demo-Role"] = init.role;
    headers["X-Demo-User"] = USER[init.role];
  }
  let body = init?.body;
  if (init?.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  const r = await fetch(path, { cache: "no-store", ...init, headers, body });
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    throw new Error(typeof b.detail === "string" ? b.detail : `HTTP ${r.status}`);
  }
  return r.json();
}

export const ACTION_LABEL: Record<string, string> = {
  one_off_exception: "Allow once (one-off exception)",
  request_customer_correction: "Ask customer to correct",
  change_quantity: "Change quantity (authorised)",
  accept_printed_price: "Accept printed price",
  correct_price: "Correct price",
  apply_mapping: "Apply replacement GTIN",
  map_item: "Map to product",
  confirm_conversion: "Confirm conversion",
  confirm_field: "Confirm value",
  acknowledge_total_difference: "Acknowledge difference",
  accept_as_revision: "Accept as revision",
  reject_order: "Reject order",
};

export const REVIEW_LABEL: Record<string, [string, string]> = {
  validating: ["Validating", "info"], needs_review: ["Needs review", "warn"], ready: ["Waiting for approval", "warn"],
  approved: ["Approved", "ok"], rejected: ["Rejected", "bad"], awaiting_customer: ["Waiting on customer", "warn"],
  amendment_held: ["Amendment held", "warn"],
};
export const DELIVERY_LABEL: Record<string, [string, string]> = {
  not_started: ["Not sent", "muted"], queued: ["Queued", "info"], submitting: ["Submitting", "info"],
  erp_created: ["In ERP", "ok"], failed: ["Delivery failed", "bad"], unknown: ["Outcome unknown", "warn"],
};
export const PROCESS_LABEL: Record<string, [string, string]> = {
  received: ["Received", "info"], extracting: ["Reading PDF", "info"], extracted: ["Extracted", "info"],
  matching: ["Matching", "info"], validating: ["Validating", "info"], needs_review: ["Checked", "ok"],
  ready_for_approval: ["Checked", "ok"], approved: ["Checked", "ok"], rejected: ["Checked", "ok"],
  awaiting_customer: ["Checked", "ok"], extraction_unavailable: ["Extraction unavailable", "warn"],
  extraction_failed: ["Extraction failed", "bad"], unsupported: ["Unsupported (no text)", "bad"],
  duplicate: ["Duplicate file", "warn"],
};
export const IN_FLIGHT = new Set(["received", "extracting", "extracted", "matching", "validating"]);
export const STOPPED = new Set(["extraction_unavailable", "extraction_failed", "unsupported", "duplicate"]);

/** Poll helper: skips ticks while the browser tab is hidden, and slows down on hosted builds
 * (set NEXT_PUBLIC_POLL_FACTOR=2 on the frontend project to halve request volume). Not a secret. */
const POLL_FACTOR = Math.max(1, Number(process.env.NEXT_PUBLIC_POLL_FACTOR || 1));
export function every(fn: () => void, ms: number): () => void {
  const t = setInterval(() => { if (typeof document === "undefined" || !document.hidden) fn(); }, ms * POLL_FACTOR);
  return () => clearInterval(t);
}
