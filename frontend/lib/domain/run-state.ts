// RunState: one demo run, held in the browser tab (sessionStorage) and sent to the stateless server
// with each action. It mirrors the twelve SQLite tables of the Python prototype as arrays, so the
// workflow keeps its shape when it is ported.
//
// Naming: the run's own records use camelCase. Payloads that the Python code produces and that later
// slices must match byte for byte (extraction payload, validation result, ERP order payload,
// reference data) keep their snake_case keys.
//
// Money and quantities are always strings. A JSON number in any of those fields is rejected, so a
// binary float can never enter the run.
import { z } from "zod";
import { SupplierReplyInterpretation } from "./reply";
import { ManualRouteAssumptions } from "./manual-route-schema";
import { PROFILE_IDS } from "./compliance";

// ---------- primitives ----------

/** Canonical decimal produced by our own code, e.g. "24.00", "5", "-1.5". Never a JSON number. */
export const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/, "must be a decimal string such as 24.00");
/** Text copied from a document or email. Untrusted; may be anything, including an unreadable number. */
const text = z.string();
const maybe = <T extends z.ZodType>(t: T) => t.nullable();
const isoTime = z.iso.datetime({ offset: true });
const id = z.number().int().positive();
/** Free-form JSON detail on audit events. */
const jsonValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValue), z.record(z.string(), jsonValue)]),
);

// ---------- closed sets ----------

export const IntakeMode = z.enum(["eml_import", "demo_envelope_upload", "local_forward_demo"]);
export const DocumentStatus = z.enum([
  "received", "duplicate", "unsupported", "extracting", "extraction_unavailable", "extraction_failed",
  "extracted", "matching", "validating", "needs_review", "ready_for_approval", "approved", "rejected",
  "awaiting_customer",
  /** D62: the agent read the message or file and found no purchase order; a person can correct it. */
  "not_order",
  /** D64: a person paused the order on purpose (internal hold, separate from waiting on the customer). */
  "on_hold",
]);
export const ReviewState = z.enum(["validating", "needs_review", "ready", "approved", "rejected", "awaiting_customer",
  "amendment_held", "on_hold"]);
export const DeliveryState = z.enum(["not_started", "queued", "submitting", "erp_created", "failed", "unknown"]);
export const PolicyMode = z.enum(["review_all", "exception_only"]);
export const Role = z.enum(["viewer", "reviewer", "administrator"]);
export const ApprovalKind = z.enum(["human", "system"]);
export const RuleState = z.enum(["candidate", "active", "revoked"]);
export const ErpFailureMode = z.enum(["none", "fail_next", "timeout_next"]);
export const IssueCode = z.enum([
  "unknown_customer", "unknown_ship_to", "missing_po_number", "missing_currency", "currency_mismatch",
  "unverified_field", "missing_line_value", "unknown_item", "unknown_unit", "unit_conversion", "moq_violation",
  "price_mismatch", "outdated_identifier", "rule_needs_revalidation", "line_amount_mismatch", "total_mismatch",
  "possible_revision",
  // D63, D65: checks added on top of the Python parity port (lib/domain/checks.ts).
  "ambiguous_date", "unclear_date", "source_conflict", "value_not_on_line",
]);
export const DecisionAction = z.enum([
  "confirm_field", "map_item", "confirm_conversion", "one_off_exception", "request_customer_correction",
  "change_quantity", "accept_printed_price", "correct_price", "apply_mapping", "acknowledge_total_difference",
  "accept_as_revision", "reject_order",
  /** D63: a person picks the calendar date an unclear printed date means. */
  "choose_date",
  /** D65: a person picks the ship-to on file that an unrecognised location means. */
  "choose_ship_to",
]);
/** D64: short reason choices. Typing an explanation is never required (Mandip, 2026-10-16). */
export const RejectReason = z.enum(["not_an_order", "duplicate", "wrong_supplier", "customer_cancelled", "cannot_supply", "other"]);
export const HoldReason = z.enum(["checking_with_buyer", "pricing_review", "stock_review", "credit_review", "other"]);
/** D62: how an order reached the agent. Each route has its own supervision setting per retailer. */
export const Channel = z.enum(["email_attachment", "email_body", "upload", "edi"]);

// ---------- extraction payload (order_versions.payload_json) ----------

export const ExtractedField = z.strictObject({
  value: maybe(text),
  page: maybe(z.number().int().positive()),
  evidence: maybe(text),
  evidence_verified: z.boolean(),
  notes: z.array(z.string()),
});
const headerFields = ["customer_name", "customer_id", "supplier", "po_number", "ship_to_id", "order_date",
  "requested_delivery_date", "currency", "subtotal", "tax", "shipping", "total"] as const;
const lineFields = ["source_line_id", "gtin", "customer_item_code", "description", "quantity", "unit",
  "unit_price", "line_amount"] as const;
const fieldsOf = <K extends readonly string[]>(keys: K) =>
  z.strictObject(Object.fromEntries(keys.map((k) => [k, ExtractedField])) as { [P in K[number]]: typeof ExtractedField });

/** D59: order terms read from any PO layout (outside the Python parity payload). Each value is checked like the rest. */
export const termFields = ["payment_terms", "freight_terms", "ship_not_before", "ship_no_later_than", "delivery_window",
  "ship_complete"] as const;
export const OrderTerms = z.strictObject({
  ...Object.fromEntries(termFields.map((k) => [k, ExtractedField.optional()])) as { [P in (typeof termFields)[number]]: z.ZodOptional<typeof ExtractedField> },
  /** The buyer's printed instructions, word for word. Shown to a person; never acted on as commands. */
  instructions: z.array(ExtractedField).max(30).optional(),
});
export type OrderTerms = z.infer<typeof OrderTerms>;

export const ExtractionPayload = z.strictObject({
  schema_version: z.literal("order-extraction-v1"),
  extractor: z.strictObject({ name: z.string(), is_ai: z.boolean() }),
  header: fieldsOf(headerFields),
  /** supplier_sku (D59): the supplier's own item number when the PO prints one; outside the parity payload. */
  lines: z.array(fieldsOf(lineFields).extend({ supplier_sku: ExtractedField.optional() })),
  applied_decisions: z.array(id).optional(),
  terms: OrderTerms.optional(),
  /** "scan": no text layer; the AI read page images and transcribed them, so a person checks every value. */
  source: z.enum(["text", "scan"]).optional(),
});

// ---------- validation result (orders.validation_json) ----------

const ResolvedBy = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("review_decision"), text: z.string() }),
  z.strictObject({
    type: z.literal("memory_rule"), rule_id: id, approved_by: maybe(z.string()), activated_at: maybe(isoTime),
    text: z.string(),
  }),
]);

export const CanonicalLine = z.strictObject({
  line_index: z.number().int().nonnegative(),
  source_line_id: z.string(),
  printed_gtin: maybe(text),
  customer_item_code: maybe(text),
  /** D59: the supplier's own item number when the PO printed one. */
  supplier_sku: text.optional(),
  description: maybe(text),
  original_quantity: maybe(text),
  original_unit: maybe(text),
  printed_unit_price: maybe(text),
  printed_line_amount: maybe(text),
  sku: maybe(z.string()),
  gtin: maybe(z.string()),
  quantity: maybe(decimalString),
  unit: maybe(z.string()),
  unit_price: maybe(decimalString),
  line_amount: maybe(decimalString),
  resolved_by: maybe(ResolvedBy),
  evidence: maybe(text),
  page: maybe(z.number().int().positive()),
  description_reference: z.string().optional(),
  edited: z.literal(true).optional(),
});

export const CanonicalOrder = z.strictObject({
  customer_id: maybe(z.string()),
  customer_name: maybe(z.string()),
  po_number: maybe(z.string()),
  currency: maybe(z.string()),
  ship_to_id: maybe(z.string()),
  order_date: maybe(z.string()),
  requested_delivery_date: maybe(z.string()),
  lines: z.array(CanonicalLine),
  totals: z.strictObject({
    printed_subtotal: maybe(text),
    printed_tax: maybe(text),
    printed_shipping: maybe(text),
    printed_total: maybe(text),
    computed_subtotal: decimalString,
    computed_total: decimalString,
    rounding: z.literal("ROUND_HALF_UP to 0.01"),
  }),
  reference_version: z.string(),
  policy_version: z.string(),
  /** D63: calendar dates a person chose for unclear printed dates (the printed values above are kept as printed). */
  resolved_dates: z.record(z.string(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  /** D65: the ship-to printed on the PO when a person chose another one on file. */
  printed_ship_to_id: maybe(z.string()).optional(),
});

const ProposedMapping = z.looseObject({
  mapping_id: z.string(),
  obsolete_identifier: z.string(),
  replacement_identifier: z.string(),
  replacement_sku: z.string(),
});

export const Issue = z.strictObject({
  key: z.string(),
  code: IssueCode,
  title: z.string(),
  message: z.string(),
  line_index: maybe(z.number().int().nonnegative()),
  printed_value: maybe(text),
  reference_value: maybe(z.union([z.string(), z.array(z.string())])),
  reference_version: maybe(z.string()),
  proposed_action: maybe(z.string()),
  evidence: maybe(text),
  page: maybe(z.number().int().positive()),
  blocking: z.boolean(),
  actions: z.array(DecisionAction),
  fingerprint: z.string(),
  status: z.enum(["open", "resolved"]),
  resolution: maybe(z.strictObject({
    decision_id: id, action: DecisionAction, actor: z.string(), role: Role, reason: maybe(z.string()), at: isoTime,
  })),
  // Per-code extras (validation.py passes these through `extra`).
  field: z.string().optional(),
  proposal: maybe(ProposedMapping).optional(),
  candidate_skus: z.array(z.string()).optional(),
  other_document_id: id.optional(),
  /** D63: the calendar dates an ambiguous printed date could mean. */
  candidate_dates: z.array(z.string()).optional(),
  /** D65: ship-tos on file for this customer. */
  candidate_ship_tos: z.array(z.string()).optional(),
});

/** A memory rule exactly as frozen into a validation result at first validation (snake_case, as stored). */
const RuleSnapshot = z.strictObject({
  id, kind: z.literal("identifier_mapping"), customer_id: z.string(), obsolete_identifier: z.string(),
  replacement_identifier: z.string(), replacement_sku: z.string(), reference_version: z.string(),
  state: RuleState, source_document_id: maybe(id), source_decision_id: maybe(id), evidence: maybe(text),
  created_by: z.string(), created_at: isoTime, activated_by: maybe(z.string()), activated_at: maybe(isoTime),
  revoked_by: maybe(z.string()), revoked_at: maybe(isoTime), revoke_reason: maybe(z.string()),
});

export const ValidationResult = z.strictObject({
  order: CanonicalOrder,
  issues: z.array(Issue),
  rules_snapshot: z.array(RuleSnapshot),
  version: z.number().int().positive(),
});

// ---------- reference data (bundled v1, or imported by an administrator) ----------

export const ReferenceData = z.looseObject({
  reference_version: z.string(),
  policy_version: z.string(),
  customers: z.array(z.looseObject({ customer_id: z.string(), name: z.string(), currency: z.string() })),
  products: z.array(z.looseObject({ sku: z.string(), unit: z.string() })),
  reference_prices: z.array(z.looseObject({ sku: z.string(), price: decimalString })),
  moq_rules: z.array(z.looseObject({ sku: z.string(), minimum: decimalString })).optional(),
  unit_conversions: z.array(z.looseObject({ sku: z.string(), factor: decimalString })).optional(),
});

// ---------- the run's records (one array per SQLite table) ----------

export const Envelope = z.strictObject({
  id,
  messageId: maybe(text),
  sender: maybe(text),
  receivedAt: maybe(text),
  subjectMetadata: maybe(text),
  intakeMode: IntakeMode,
  rawSha256: maybe(z.string().regex(/^[0-9a-f]{64}$/)),
  createdAt: isoTime,
  /** D62: the email's own text, kept as evidence. Untrusted data; never instructions. */
  bodyText: maybe(text).optional(),
  /** D62: every attachment the email carried and what the agent did with it. */
  attachments: z.array(z.strictObject({
    filename: maybe(z.string()), mimeType: maybe(z.string()), sizeBytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    handling: z.enum(["order_candidate", "evidence_only"]),
    note: maybe(z.string()),
  })).optional(),
});

/** The PDF bytes are never part of the run; only their hash and page text are. */
export const SourceDocument = z.strictObject({
  id,
  envelopeId: id,
  originalFilename: maybe(z.string()),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  sizeBytes: z.number().int().nonnegative(),
  pageCount: maybe(z.number().int().positive()),
  pageText: z.array(z.string()),
  status: DocumentStatus,
  statusDetail: maybe(z.string()),
  duplicateOf: maybe(id),
  createdAt: isoTime,
  updatedAt: isoTime,
  /** D62: what the document is. Absent = a PDF (runs saved before D62). */
  kind: z.enum(["pdf", "email_body", "edi"]).optional(),
  /** D62: the agent's order / not-an-order decision, and any correction by a person. */
  classification: z.strictObject({
    result: z.enum(["order", "not_order"]), reason: z.string(), by: z.string(), at: isoTime,
    correctedBy: maybe(z.string()), correctedAt: maybe(isoTime),
  }).optional(),
});

/** Append-only: each recorded decision adds a version (D20). */
export const OrderVersion = z.strictObject({
  id,
  documentId: id,
  version: z.number().int().positive(),
  origin: z.enum(["extraction", "review"]),
  extractor: maybe(z.string()),
  payload: ExtractionPayload,
  createdBy: z.string(),
  createdAt: isoTime,
});

/** Review, delivery and ERP acknowledgement are separate fields and stay separate. */
export const Order = z.strictObject({
  documentId: id,
  customerId: maybe(z.string()),
  poNumber: maybe(z.string()),
  currentVersion: z.number().int().positive(),
  reviewState: ReviewState,
  deliveryState: DeliveryState,
  erpOrderId: maybe(z.string()),
  validation: ValidationResult,
  updatedAt: isoTime,
  /** D61: stock check and ship dates, set when the order reaches the ERP. Optional so earlier runs load. */
  fulfilment: z.lazy(() => Fulfilment).optional(),
});

export const Decision = z.strictObject({
  id,
  documentId: id,
  issueKey: z.string(),
  fingerprint: maybe(z.string()),
  action: DecisionAction,
  params: z.strictObject({
    sku: z.string().optional(),
    obsolete_identifier: z.string().optional(),
    replacement_identifier: z.string().optional(),
    replacement_sku: z.string().optional(),
    save_for_future: z.boolean().optional(),
    line_index: z.number().int().nonnegative().optional(),
    value: decimalString.optional(),
    authorised_by: z.string().optional(),
    note: z.string().optional(),
    /** D63: chosen date (YYYY-MM-DD) and which field it is for. */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    field: z.string().optional(),
    /** D65: chosen ship-to on file. */
    ship_to_id: z.string().optional(),
    /** D64: reason choice on reject. */
    reason_code: RejectReason.optional(),
  }),
  reason: maybe(z.string()),
  actor: z.string(),
  role: Role,
  versionCreated: maybe(z.number().int().positive()),
  createdAt: isoTime,
});

export const Approval = z.strictObject({
  id,
  documentId: id,
  version: z.number().int().positive(),
  kind: ApprovalKind,
  actor: z.string(),
  policyMode: PolicyMode,
  policyVersion: id,
  createdAt: isoTime,
  invalidatedAt: maybe(isoTime),
  invalidatedReason: maybe(z.string()),
});

/** A policy entry. Without customerId it is the default for routes with no setting of their own (D64); with
 *  customerId and channel it applies to that retailer's orders on that route. Automatic needs a reason. */
export const PolicyChange = z.strictObject({ id, mode: PolicyMode, setBy: z.string(), effectiveAt: isoTime,
  customerId: z.string().optional(), channel: Channel.optional(), reason: z.string().optional() });

export const MemoryRule = z.strictObject({
  id,
  kind: z.literal("identifier_mapping"),
  customerId: z.string(),
  obsoleteIdentifier: z.string(),
  replacementIdentifier: z.string(),
  replacementSku: z.string(),
  referenceVersion: z.string(),
  state: RuleState,
  sourceDocumentId: maybe(id),
  sourceDecisionId: maybe(id),
  evidence: maybe(text),
  createdBy: z.string(),
  createdAt: isoTime,
  activatedBy: maybe(z.string()),
  activatedAt: maybe(isoTime),
  revokedBy: maybe(z.string()),
  revokedAt: maybe(isoTime),
  revokeReason: maybe(z.string()),
});

export const DeliveryAttempt = z.strictObject({
  id,
  documentId: id,
  version: z.number().int().positive(),
  idempotencyKey: z.string(),
  state: DeliveryState.exclude(["not_started"]),
  detail: maybe(z.string()),
  erpOrderId: maybe(z.string()),
  createdAt: isoTime,
  updatedAt: isoTime,
});

/** ERP simulator record. The idempotency key is looked up before every submission (D23). */
export const ErpOrder = z.strictObject({
  erpOrderId: z.string().regex(/^SIM-ERP-\d+$/),
  idempotencyKey: z.string(),
  payload: z.strictObject({
    idempotency_key: z.string(),
    approved_version: z.number().int().positive(),
    approval: z.strictObject({ kind: ApprovalKind, actor: z.string(), policy: PolicyMode }),
    order: CanonicalOrder,
  }),
  createdAt: isoTime,
});

export const AuditEvent = z.strictObject({
  id,
  entityType: z.enum(["system", "envelope", "document", "policy", "memory_rule", "finding"]),
  entityId: z.number().int().nonnegative(),
  event: z.string(),
  actor: z.string(),
  detail: z.record(z.string(), jsonValue),
  createdAt: isoTime,
});

export const Settings = z.strictObject({
  /** The demo role actions are taken as (D22: demo-only roles, no real authentication). */
  role: Role,
  rehearsalMode: z.boolean(),
  erpFailureMode: ErpFailureMode,
  /** null means the bundled fixtures/reference-data.v1.json; reset returns to it. */
  referenceData: maybe(ReferenceData),
});

// ---------- supplier portal: ASN, invoice and outbound messages (D45, all simulated) ----------

export const OutboundKind = z.enum(["ORDRSP", "DESADV", "INVOIC", "ERP_SHIPMENT", "ERP_INVOICE", "ERP_ORDER_CHANGE"]);
export const OutboundChannel = z.enum(["retailer_edi_outbox", "supplier_erp"]);
export const OutboundStatus = z.enum(["pending", "delivered", "failed"]);
export const EdiFailureMode = z.enum(["none", "fail_next", "hold_next"]);

export const AsnLine = z.strictObject({
  lineIndex: z.number().int().nonnegative(),
  sourceLineId: z.string(),
  sku: z.string(),
  gtin: maybe(z.string()),
  description: maybe(text),
  unit: z.string(),
  orderedQty: decimalString,
  shippedQty: decimalString,
  overrideReason: maybe(z.string()),
  /** D52: quantity still open on the order when this ASN was made (absent = the whole order, first ASN). */
  openQty: decimalString.optional(),
});

/** D47 packing: pallets, each holding cartons, each holding quantities of ASN lines. Every unit has an SSCC. */
const ssccString = z.string().regex(/^\d{18}$/);
export const Pallet = z.strictObject({
  sscc: ssccString,
  cartons: z.array(z.strictObject({
    sscc: ssccString,
    contents: z.array(z.strictObject({ lineIndex: z.number().int().nonnegative(), quantity: decimalString })).min(1),
  })).min(1),
});

/** Advance shipping notice. Submitted in one step; one per delivered order. */
export const Asn = z.strictObject({
  id,
  asnNumber: z.string().regex(/^ASN-\d{5}$/),
  documentId: id,
  erpOrderId: z.string(),
  lines: z.array(AsnLine).min(1),
  /** D47 (optional so earlier runs load): dates as YYYY-MM-DD and the packing hierarchy. */
  despatchDate: z.string().optional(),
  estimatedDelivery: z.string().optional(),
  /** D51: carrier SCAC, bill of lading and tracking (PRO) number, all optional. */
  carrierScac: z.string().optional(),
  bolNumber: z.string().optional(),
  trackingNumber: z.string().optional(),
  pallets: z.array(Pallet).optional(),
  createdBy: z.string(),
  createdAt: isoTime,
});

export const InvoiceLine = z.strictObject({
  lineIndex: z.number().int().nonnegative(),
  sourceLineId: z.string(),
  sku: z.string(),
  gtin: maybe(z.string()),
  description: maybe(text),
  unit: z.string(),
  quantity: decimalString,
  unitPrice: decimalString,
  lineAmount: decimalString,
  /** D47: tax rate in percent. */
  taxRate: decimalString.optional(),
});

/** SALES = US sales tax (D50); usually zero on wholesale for resale. */
export const TaxType = z.enum(["VAT", "GST", "SALES"]);
/** D47: an allowance (discount) or charge on the whole invoice, at one tax rate. */
export const InvoiceAllowance = z.strictObject({
  kind: z.enum(["allowance", "charge"]),
  code: z.string(),
  description: z.string(),
  percent: maybe(decimalString),
  amount: decimalString,
  taxRate: decimalString,
});

/** Invoice built from a submitted ASN: quantities from the ASN, prices from the delivered order. */
/** D52: payment terms, as on a US invoice: "2% 10 net 30" = 2% off if paid in 10 days, otherwise due in 30. */
export const PaymentTerms = z.strictObject({
  discountPercent: maybe(decimalString),
  discountDays: maybe(z.number().int().min(0).max(365)),
  netDays: z.number().int().min(0).max(365),
});

export const Invoice = z.strictObject({
  id,
  invoiceNumber: z.string().regex(/^INV-\d{5}$/),
  asnId: id,
  documentId: id,
  currency: z.string(),
  lines: z.array(InvoiceLine).min(1),
  subtotal: decimalString,
  total: decimalString,
  rounding: z.literal("ROUND_HALF_UP to 0.01"),
  /** D47 (optional so earlier runs load): tax and allowances. subtotal = line total; total = invoice amount. */
  taxType: TaxType.optional(),
  allowances: z.array(InvoiceAllowance).optional(),
  taxableAmount: decimalString.optional(),
  taxAmount: decimalString.optional(),
  taxByRate: z.array(z.strictObject({ rate: decimalString, taxable: decimalString, tax: decimalString })).optional(),
  /** D52: payment terms and the due date they give. */
  terms: PaymentTerms.optional(),
  dueDate: z.string().optional(),
  createdBy: z.string(),
  createdAt: isoTime,
});

export const OutboundMessage = z.strictObject({
  id,
  kind: OutboundKind,
  channel: OutboundChannel,
  documentId: id,
  sourceType: z.enum(["order", "asn", "invoice"]),
  sourceId: z.string(),
  idempotencyKey: z.string(),
  status: OutboundStatus,
  format: z.enum(["edifact", "x12", "json"]),
  body: z.string(),
  mapping: z.array(z.strictObject({ segment: z.string(), meaning: z.string() })),
  attempts: z.array(z.strictObject({ at: isoTime, outcome: z.string(), detail: z.string() })),
  receiverRef: maybe(z.string()),
  /** D47: the retailer rule check this message passed (optional so earlier runs load). */
  compliance: z.lazy(() => ComplianceSummary).optional(),
  createdAt: isoTime,
  updatedAt: isoTime,
});

/** What the simulated receivers hold, keyed by idempotency key so a retry is reconciled, not duplicated. */
export const ReceivedMessage = z.strictObject({
  receiverRef: z.string(),
  channel: OutboundChannel,
  kind: OutboundKind,
  idempotencyKey: z.string(),
  body: z.string(),
  receivedAt: isoTime,
});

export const ComplianceSummary = z.strictObject({
  profile: z.enum(PROFILE_IDS),
  rulesChecked: z.number().int().nonnegative(),
  rulesPassed: z.number().int().nonnegative(),
  findings: z.array(z.strictObject({
    ruleId: z.string(), severity: z.enum(["block", "warn"]), text: z.string(),
    basis: z.enum(["sourced", "inferred"]), sources: z.array(z.string()),
  })),
});

const glnString = z.string().regex(/^\d{13}$/);
const setupMeta = { updatedBy: z.string(), updatedAt: isoTime };
/** D47: the supplier's own EDI identity. Absent means the labelled fictional demo supplier. */
export const SupplierSetup = z.strictObject({
  name: maybe(z.string()),
  gln: glnString,
  vatId: maybe(z.string()),
  /** GS1 company prefix used to number SSCCs. */
  companyPrefix: z.string().regex(/^\d{6,12}$/),
  taxType: TaxType,
  defaultTaxRate: maybe(decimalString),
  paymentTerms: PaymentTerms.optional(),
  ...setupMeta,
});
/** D47: per retailer (customer) EDI setup. Absent means the default for that customer (see partners.ts). */
export const TradingPartner = z.strictObject({
  customerId: z.string(),
  profile: z.enum(PROFILE_IDS),
  buyerGln: maybe(glnString),
  buyerVatId: maybe(z.string()),
  contractRef: maybe(z.string()),
  /** D50: the supplier's vendor number at this retailer (X12 REF*IA), optional. */
  vendorNumber: maybe(z.string()).optional(),
  shipToGlns: z.array(z.strictObject({ shipToId: z.string(), gln: glnString })),
  ...setupMeta,
});

export const Portal = z.strictObject({
  asns: z.array(Asn),
  invoices: z.array(Invoice),
  outbound: z.array(OutboundMessage),
  received: z.array(ReceivedMessage),
  ediFailureMode: EdiFailureMode,
  /** D47, optional so earlier runs load. */
  supplier: SupplierSetup.optional(),
  partners: z.array(TradingPartner).optional(),
  /** Last SSCC serial reference used in this run. */
  ssccSerial: z.number().int().nonnegative().optional(),
  /** D52: order quantities the supplier will not ship (backorder cancelled). */
  cancellations: z.array(z.strictObject({ documentId: id, lineIndex: z.number().int().nonnegative(), quantity: decimalString,
    reason: z.string(), createdBy: z.string(), createdAt: isoTime })).optional(),
  /** D54: supplier replies to a PO, read by the agent and confirmed by a person. */
  replies: z.array(z.strictObject({ id, documentId: id, text: z.string(), interpretation: SupplierReplyInterpretation,
    appliedBy: z.string(), appliedAt: isoTime })).optional(),
  /** D67: the retailer's answer to a changed order confirmation (simulated retailer system, recorded in its view). */
  retailerResponses: z.array(z.strictObject({ id, documentId: id, messageId: id, decision: z.enum(["accepted", "declined"]),
    by: z.string(), at: isoTime })).optional(),
});
export const emptyPortal = (): z.infer<typeof Portal> =>
  ({ asns: [], invoices: [], outbound: [], received: [], ediFailureMode: "none" });

// ---------- session onboarding (D46): customers and products a reviewer added during this run ----------

const addedMeta = { addedBy: z.string(), addedAt: isoTime, sourceDocumentId: id };
export const ReferenceOverlay = z.strictObject({
  customers: z.array(z.strictObject({
    customerId: z.string(), name: z.string(), currency: z.string().regex(/^[A-Z]{3}$/),
    /** Ship-to IDs on file; empty when the PO printed none (ship-to is then not checked for this customer). */
    shipToIds: z.array(z.string()), printedAs: maybe(text), ...addedMeta,
  })),
  /** A printed customer name or ID that a reviewer assigned to a customer already on file. */
  customerAliases: z.array(z.strictObject({ printed: text, customerId: z.string(), ...addedMeta })),
  shipTos: z.array(z.strictObject({ customerId: z.string(), shipToId: text, ...addedMeta })),
  products: z.array(z.strictObject({
    sku: z.string(), gtin: maybe(text), customerItemCode: maybe(text), customerId: z.string(), description: text,
    unit: text, price: decimalString, currency: z.string(), moq: decimalString, ...addedMeta,
  })),
});
export const emptyOverlay = (): z.infer<typeof ReferenceOverlay> =>
  ({ customers: [], customerAliases: [], shipTos: [], products: [] });

// ---------- D61: ERP stock, the stock check and ship dates (simulated ERP) ----------

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const StockItem = z.strictObject({
  sku: z.string(),
  onHand: decimalString,
  /** Calendar days to get more when nothing is on order. */
  leadTimeDays: z.number().int().nonnegative(),
  /** Purchase orders the supplier has placed with its own suppliers, not yet received. */
  incoming: z.array(z.strictObject({ ref: z.string(), quantity: decimalString, expected: isoDay })),
});
export const ShortStockPolicy = z.enum(["ask", "ship_complete", "split"]);
export const FulfilmentSettings = z.strictObject({
  /** Working days to pick, pack and load once stock is there. */
  packDays: z.number().int().min(0).max(30),
  /** Working days in transit to a retailer's dock, unless the retailer has its own. */
  transitDays: z.number().int().min(0).max(30),
  shortStock: ShortStockPolicy,
  retailers: z.array(z.strictObject({ customerId: z.string(), transitDays: z.number().int().min(0).max(30).optional(),
    shortStock: ShortStockPolicy.optional() })),
  updatedBy: z.string().optional(), updatedAt: isoTime.optional(),
});
export const FulfilmentLine = z.strictObject({
  lineIndex: z.number().int().nonnegative(),
  sku: maybe(z.string()),
  ordered: decimalString,
  /** Free stock for this line when the order reached the ERP (on hand less what other orders hold). */
  availableNow: decimalString,
  short: decimalString,
  /** When the short quantity can be picked: an expected delivery from the supplier's own PO, or the lead time. */
  shortReadyOn: maybe(isoDay),
  shortSource: maybe(z.enum(["incoming", "lead_time"])),
});
export const ShipPart = z.strictObject({ lineIndex: z.number().int().nonnegative(), quantity: decimalString,
  shipOn: maybe(isoDay), kind: z.enum(["now", "backorder", "cancelled"]) });
export const Fulfilment = z.strictObject({
  checkedOn: isoDay,
  lines: z.array(FulfilmentLine),
  window: z.strictObject({ notBefore: maybe(isoDay), noLaterThan: maybe(isoDay), deliverBy: maybe(isoDay),
    transitDays: z.number().int().nonnegative(), packDays: z.number().int().nonnegative() }),
  /** Latest day the goods can leave and still arrive on time; null when the PO gives no date. */
  shipBy: maybe(isoDay),
  options: z.strictObject({
    ship_complete: z.strictObject({ parts: z.array(ShipPart), late: z.boolean() }),
    split: z.strictObject({ parts: z.array(ShipPart), late: z.boolean() }).optional(),
    ship_available: z.strictObject({ parts: z.array(ShipPart), late: z.boolean() }).optional(),
  }),
  recommended: z.enum(["ship_complete", "split", "ship_available"]),
  status: z.enum(["confirmed", "needs_decision"]),
  choice: z.enum(["ship_complete", "split", "ship_available"]).nullable(),
  decidedBy: maybe(z.string()),
  decidedAt: maybe(isoTime),
  /** The plan the retailer was told: per line what ships when, what is backordered, what will not ship. */
  parts: z.array(ShipPart),
});

// ---------- D66: proposed Retail Command Center (Detect, Prioritise, Act, Verify) ----------

export const FindingType = z.enum(["stock_short", "revised_delivery", "erp_outcome", "retailer_message"]);
/** Every statement on a finding says what kind of statement it is, so facts, rules and decisions never blur. */
export const FindingEvidence = z.strictObject({
  kind: z.enum(["observed", "rule", "human", "outcome"]),
  text: z.string(),
  source: z.string(),
  at: maybe(isoTime),
});
export const Finding = z.strictObject({
  id,
  type: FindingType,
  /** One open finding per condition: the key names the condition (type and the record it is about). */
  key: z.string(),
  documentId: id,
  customerId: maybe(z.string()),
  poNumber: maybe(z.string()),
  lines: z.array(z.strictObject({ lineIndex: z.number().int().nonnegative(), label: z.string() })),
  /** supplier = supplier users only (it rests on supplier-private records); shared = the retailer sees it too. */
  visibility: z.enum(["supplier", "shared"]),
  detectedAt: isoTime,
  observedAt: isoTime,
  conditionActive: z.boolean(),
  observed: z.array(FindingEvidence),
  rule: z.strictObject({ text: z.string(), source: z.string() }),
  deadline: maybe(z.strictObject({ at: isoTime, source: z.string() })),
  priority: z.strictObject({ level: z.enum(["high", "medium", "low"]), basis: z.string() }),
  owner: maybe(z.strictObject({ actor: z.string(), source: z.enum(["configured", "assigned"]), by: z.string(), at: isoTime })),
  nextAction: z.strictObject({ text: z.string(), target: z.enum(["stock", "delivery", "outbound", "retailer_response"]) }),
  actionStatus: z.enum(["not_started", "completed"]),
  resolution: z.strictObject({ condition: z.string(), evidenceRequired: z.string() }),
  verification: z.strictObject({ status: z.enum(["pending", "verified"]), evidence: z.array(FindingEvidence), at: maybe(isoTime) }),
  history: z.array(z.strictObject({ at: isoTime, kind: z.enum(["detected", "changed", "condition_cleared", "assigned",
    "action", "verified", "reopened"]), actor: z.string(), text: z.string() })),
});
export const CommandCenterState = z.strictObject({
  findings: z.array(Finding),
  /** Configured owner per finding type; absent or null = Unassigned. */
  ownership: z.record(z.string(), z.string().nullable()),
});
export type Finding = z.infer<typeof Finding>;
export type CommandCenterState = z.infer<typeof CommandCenterState>;

export const RUN_STATE_SCHEMA_VERSION = "run-state-v1";

export const RunState = z.strictObject({
  schemaVersion: z.literal(RUN_STATE_SCHEMA_VERSION),
  envelopes: z.array(Envelope),
  documents: z.array(SourceDocument),
  versions: z.array(OrderVersion),
  orders: z.array(Order),
  decisions: z.array(Decision),
  approvals: z.array(Approval),
  policyHistory: z.array(PolicyChange).min(1),
  memoryRules: z.array(MemoryRule),
  deliveries: z.array(DeliveryAttempt),
  erpOrders: z.array(ErpOrder),
  audit: z.array(AuditEvent),
  settings: Settings,
  /** Added by D45. Optional so runs saved before it (and the Python exports) load unchanged. */
  portal: Portal.optional(),
  /** Added by D46. Optional for the same reason; absent means no session additions. */
  referenceOverlay: ReferenceOverlay.optional(),
  /** Added by D49: the administrator's Act 1 assumptions. Optional; absent means the labelled defaults. */
  manualRoute: ManualRouteAssumptions.optional(),
  /** D61: ERP stock. Absent means the bundled fictional stock file (erp-stock.v1.json). */
  erpStock: z.array(StockItem).optional(),
  /** D61: packing and transit days, and what to do when stock is short. Absent means the defaults. */
  fulfilmentSettings: FulfilmentSettings.optional(),
  /** D64: internal holds, with the reason chosen and who released them. */
  holds: z.array(z.strictObject({ id, documentId: id, reason: HoldReason, heldBy: z.string(), heldAt: isoTime,
    releasedBy: maybe(z.string()), releasedAt: maybe(isoTime) })).optional(),
  /** D66: the proposed Command Center's findings and ownership settings. */
  commandCenter: z.lazy(() => CommandCenterState).optional(),
});

export type RunState = z.infer<typeof RunState>;
export type Envelope = z.infer<typeof Envelope>;
export type SourceDocument = z.infer<typeof SourceDocument>;
export type OrderVersion = z.infer<typeof OrderVersion>;
export type Order = z.infer<typeof Order>;
export type Decision = z.infer<typeof Decision>;
export type Approval = z.infer<typeof Approval>;
export type PolicyChange = z.infer<typeof PolicyChange>;
export type MemoryRule = z.infer<typeof MemoryRule>;
export type DeliveryAttempt = z.infer<typeof DeliveryAttempt>;
export type ErpOrder = z.infer<typeof ErpOrder>;
export type AuditEvent = z.infer<typeof AuditEvent>;
export type Asn = z.infer<typeof Asn>;
export type Portal = z.infer<typeof Portal>;
export type Invoice = z.infer<typeof Invoice>;
export type OutboundMessage = z.infer<typeof OutboundMessage>;
export type Pallet = z.infer<typeof Pallet>;
export type InvoiceAllowance = z.infer<typeof InvoiceAllowance>;
export type SupplierSetup = z.infer<typeof SupplierSetup>;
export type TradingPartner = z.infer<typeof TradingPartner>;
export type ComplianceSummary = z.infer<typeof ComplianceSummary>;
export type ExtractionPayload = z.infer<typeof ExtractionPayload>;
export type ValidationResult = z.infer<typeof ValidationResult>;
export type ReferenceData = z.infer<typeof ReferenceData>;
export type ReferenceOverlay = z.infer<typeof ReferenceOverlay>;
export type StockItem = z.infer<typeof StockItem>;
export type FulfilmentSettings = z.infer<typeof FulfilmentSettings>;
export type Fulfilment = z.infer<typeof Fulfilment>;
export type ShipPart = z.infer<typeof ShipPart>;

/** A fresh run, as after "Reset demo": Review-all policy, bundled reference data, nothing received. */
export function emptyRunState(now: string = new Date().toISOString()): RunState {
  return {
    schemaVersion: RUN_STATE_SCHEMA_VERSION,
    envelopes: [], documents: [], versions: [], orders: [], decisions: [], approvals: [],
    policyHistory: [{ id: 1, mode: "review_all", setBy: "system:order-agent", effectiveAt: now }],
    memoryRules: [], deliveries: [], erpOrders: [], audit: [],
    settings: { role: "viewer", rehearsalMode: false, erpFailureMode: "none", referenceData: null },
    portal: emptyPortal(),
  };
}

/** Browsers allow about 5 MB of sessionStorage per tab; warn well before that. */
export const SESSION_STORAGE_WARN_BYTES = 4 * 1024 * 1024;

export function runStateSizeBytes(state: RunState): number {
  return new TextEncoder().encode(JSON.stringify(state)).length;
}
export type Channel = z.infer<typeof Channel>;
export type FindingType = z.infer<typeof FindingType>;
