// Order Operations (D71): the order journey from an emailed PDF to a simulated downstream ERP, with explicit
// states, field states, issues, human decisions and a readable event history. Pure data; no React here.
// Money and quantities are decimal strings, never JSON numbers.

/** Who did something. "agent" is reserved for AI recommendations, so they stay visibly apart from rules. */
export type ActorKind = "system" | "agent" | "person" | "erp";
export type Actor = { kind: ActorKind; name: string };

export const ORDER_STATES = ["received", "understanding", "validating", "needs_review", "blocked", "ready_to_send",
  "sending", "accepted", "rejected"] as const;
export type OrderState = (typeof ORDER_STATES)[number];

export const ISSUE_TYPES = ["correctable_discrepancy", "ambiguous_match", "missing_required_data", "validation_failure",
  "downstream_rejection"] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

export const DECISION_OUTCOMES = ["accepted_recommendation", "rejected_recommendation", "selected_option",
  "corrected_value", "deferred"] as const;
export type DecisionOutcome = (typeof DECISION_OUTCOMES)[number];

export const FIELD_STATES = ["accepted", "changed", "uncertain", "missing", "invalid"] as const;
export type FieldState = (typeof FIELD_STATES)[number];

export type HeaderKey = "po_number" | "buyer" | "supplier" | "delivery_location" | "delivery_date";
export type LineKey = "description" | "sku" | "quantity" | "unit" | "unit_price";
export type FieldKey = HeaderKey | LineKey;

/** Where a value sits in the source: the PDF page region or a line of the email text. */
export type SourceRef = { doc: "pdf" | "email"; page: number; region: string };

export type OpsField = {
  key: FieldKey;
  label: string;
  /** As read from the source document. null = not present in the source. */
  extracted: string | null;
  /** The value the structured order carries now (after decisions). */
  value: string | null;
  /** Reference data the value was checked against, as shown to a person. */
  reference: string | null;
  state: FieldState;
  source: SourceRef | null;
  /** The decision that set the current value, when a person changed it. */
  decisionId: number | null;
  note: string | null;
};

export type OpsLine = { index: number; fields: Record<LineKey, OpsField>; amount: string | null };

export type Evidence = {
  kind: "source" | "reference" | "history" | "rule" | "erp";
  text: string;
  source: SourceRef | null;
};

export type IssueOption = {
  id: string;
  label: string;
  /** Comparison rows shown beside each option, e.g. ["Size", "330 mL"]. */
  details: [string, string][];
  value: string;
  /** Set only when the evidence supports one option; never set for a genuine ambiguity. */
  recommended: boolean;
};

export type OpsIssue = {
  id: string;
  type: IssueType;
  severity: "blocking" | "warning";
  field: FieldKey;
  lineIndex: number | null;
  title: string;
  summary: string;
  whyItMatters: string;
  rule: { id: string; text: string };
  original: string | null;
  expected: string | null;
  proposed: string | null;
  /** The AI's explanation of the recommendation, uncertainty or stop. Null when no AI statement is made. */
  agentNote: string | null;
  options: IssueOption[];
  evidence: Evidence[];
  /** What a person can do about it. */
  actions: ("accept" | "keep_original" | "select" | "correct" | "defer")[];
  status: "open" | "resolved";
  decisionId: number | null;
  /** For downstream rejections: the ERP attempt that raised it. */
  attemptId: number | null;
};

export type OpsDecision = {
  id: number;
  issueId: string;
  outcome: DecisionOutcome;
  field: FieldKey;
  lineIndex: number | null;
  previous: string | null;
  value: string | null;
  actor: Actor;
  at: string;
  undoneAt: string | null;
};

export type ErpAttempt = {
  id: number;
  idempotencyKey: string;
  version: number;
  sentAt: string;
  respondedAt: string;
  request: { poNumber: string | null; account: string | null; shipTo: string | null; deliveryDate: string | null;
    lines: { sku: string | null; quantity: string | null; unit: string | null; unitPrice: string | null }[]; total: string };
  response: { status: "accepted" | "rejected"; code: string; message: string; field: FieldKey | null; erpOrderId: string | null };
  /** True when this result came from an earlier attempt with the same key, not a new submission. */
  reconciled: boolean;
};

export type ErpStatus = "not_sent" | "ready" | "sending" | "response_received" | "accepted" | "rejected";

export type OpsEvent = {
  id: number;
  at: string;
  actor: Actor;
  type: string;
  text: string;
  field: FieldKey | null;
  issueId: string | null;
};

export type PrintedLine = { line: number; itemCode: string | null; description: string; quantity: string; unit: string; unitPrice: string };
export type PrintedPo = {
  poNumber: string | null;
  orderDate: string;
  buyerName: string;
  buyerAddress: string[];
  supplierName: string;
  shipTo: { code: string | null; name: string; address: string[] } | null;
  deliveryDate: string | null;
  currency: "USD";
  terms: string;
  lines: PrintedLine[];
  notes: string[];
};

export type OpsEmail = {
  from: string;
  fromName: string;
  to: string;
  subject: string;
  receivedAt: string;
  body: string[];
};

export type OpsOrder = {
  id: string;
  /** Fictional sample in the bundled inbox. */
  sample: true;
  channel: "email_pdf";
  email: OpsEmail;
  attachment: { filename: string; sizeKb: number; pages: number; recognizedAs: "purchase_order" };
  po: PrintedPo;
  buyerId: string | null;
  header: Record<HeaderKey, OpsField>;
  lines: OpsLine[];
  total: string;
  issues: OpsIssue[];
  decisions: OpsDecision[];
  approval: { actor: Actor; at: string; version: number } | null;
  state: OrderState;
  version: number;
  erp: { status: ErpStatus; attempts: ErpAttempt[]; erpOrderId: string | null };
  history: OpsEvent[];
};

export const OPS_SCHEMA = "order-ops-v1";
export type OpsState = { schema: typeof OPS_SCHEMA; seededAt: string; orders: OpsOrder[] };
