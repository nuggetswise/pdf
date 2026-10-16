// Screen types and labels. The read models themselves are in lib/domain/selectors.ts (rebuild slice 5).
import type { Policy } from "../lib/domain/selectors";

export type {
  CanonicalOrder, DocDetail, DocSummary, ErpOrder, Field, Issue, Line, Order, Policy, Rule,
} from "../lib/domain/selectors";
export type Health = {
  status: string; extraction: string; extractor_mode: string; model: string | null; erp: string;
  rehearsal_mode: boolean; erp_failure_mode: string; policy: Policy;
};
export type Summary = {
  orders_received: number; delivered_to_erp: number; auto_approved_by_policy: number; held_for_review: number;
  resolved_by_memory: number; delivery_problems: number;
};

/** Demo-only identity: the role picked on screen travels with each action. Not real authentication. */
export type Role = "reviewer" | "administrator" | "viewer";
export const PEOPLE: Record<Role, string> = { reviewer: "Rita, order desk (reviewer)", administrator: "Alex, operations lead", viewer: "Read-only viewer" };

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
