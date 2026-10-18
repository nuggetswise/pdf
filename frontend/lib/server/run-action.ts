// The server half of every screen action (rebuild slice 5). The browser sends the whole run and one action;
// the server checks both, runs the workflow function and returns the next run. Nothing is kept on the server.
// Errors come back as values: Next masks errors thrown from server actions in production.
import "server-only";
import { z } from "zod";
import { MAX_PAGES } from "../intake/pdf";
import { normalise } from "../domain/normalise";
import { Channel, DecisionAction, ExtractionPayload, FindingType, HoldReason, IntakeMode, RejectReason, RunState } from "../domain/run-state";
import {
  Conflict, Forbidden, type Who, addCustomer, addProduct, addShipTo, approve, assignCustomer, decide, failExtraction, holdOrder, receive,
  recordExtraction, recoverDeliveries, rejectOrder, releaseHold, resetDemo, retryDelivery, retryExtraction, setDemoSetting, setPolicy,
  setRoutePolicy, setRuleState, addPolicyRule, endPolicyRule, startExtraction, treatAsOrder,
} from "../domain/workflow";
import { assignFinding, reconcileFindings, respondToRevision, setFindingOwnership } from "../domain/command-center";
import { read850 } from "../domain/extract/x12-850";
import { setManualRouteAssumptions } from "../domain/manual-route";
import { applySupplierReply, cancelBackorder, decideFulfilment, receiveStock, retryOutbound, setFulfilmentSettings, setStock, shipFromErp, setEdiFailureMode, submitAsn, submitInvoice } from "../domain/portal";
import { saveSupplierSetup, saveTradingPartner } from "../domain/partners";
import { PROFILE_IDS } from "../domain/compliance";

/** Demo-only identity (D22): the role picked on screen decides the actor label, as the X-Demo-* headers did. */
const ACTOR: Record<z.infer<typeof Role>, string> = {
  reviewer: "reviewer:rita", administrator: "administrator:alex", viewer: "viewer:viewer",
};
const INTAKE_ACTOR = "intake:local-demo-inbox";
const RETRY_ACTOR: Who = { actor: "user:demo-operator", role: "viewer" };

const Role = z.enum(["viewer", "reviewer", "administrator"]);
const docId = z.number().int().positive();
const sha = z.string().regex(/^[0-9a-f]{64}$/);
const shortText = z.string().max(2000);

const Attachment = z.strictObject({
  originalFilename: z.string().max(120).nullable(),
  sha256: sha,
  sizeBytes: z.number().int().nonnegative(),
  pageCount: z.number().int().min(1).max(MAX_PAGES),
  pageText: z.array(z.string()).min(1).max(MAX_PAGES),
  kind: z.enum(["email_body", "edi"]).optional(),
}).refine((a) => a.pageText.length === a.pageCount, "pageText must have one entry per page");
const Seen = z.strictObject({ filename: z.string().max(120).nullable(), mimeType: z.string().max(200).nullable(),
  sizeBytes: z.number().int().nonnegative(), sha256: sha, handling: z.enum(["order_candidate", "evidence_only"]),
  note: z.string().max(300).nullable() });
const Classification = z.strictObject({ result: z.enum(["order", "not_order"]), reason: z.string().max(300) });

export const Action = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("receive"),
    envelope: z.strictObject({
      messageId: shortText.nullable(), sender: shortText.nullable(), receivedAt: shortText.nullable(),
      subjectMetadata: shortText.nullable(), intakeMode: IntakeMode, rawSha256: sha.nullable(),
    }),
    attachments: z.array(Attachment).min(1).max(20),
    /** D62: the email's text and every attachment it carried. */
    email: z.strictObject({ bodyText: z.string().max(20_000).nullable(), seen: z.array(Seen).max(50) }).optional(),
  }),
  z.strictObject({ type: z.literal("startExtraction"), docId }),
  z.strictObject({ type: z.literal("recordExtraction"), docId, payload: ExtractionPayload,
    /** D59: the AI's page-by-page transcription of a scanned PDF (it had no text layer). */
    transcript: z.array(z.string().max(60_000)).max(MAX_PAGES).optional(),
    classification: Classification.optional() }),
  z.strictObject({ type: z.literal("failExtraction"), docId,
    kind: z.enum(["unsupported", "extraction_unavailable", "extraction_failed"]), detail: z.string().min(1).max(500) }),
  z.strictObject({ type: z.literal("retryExtraction"), docId }),
  z.strictObject({
    type: z.literal("decide"), role: Role, docId, issueKey: z.string().min(1).max(200), action: DecisionAction,
    reason: shortText.nullable().optional(),
    params: z.strictObject({ sku: z.string().max(100).optional(), save_for_future: z.boolean().optional(),
      value: z.string().max(100).optional(), note: shortText.optional(), date: z.string().max(10).optional(),
      ship_to_id: z.string().max(200).optional(), reason_code: RejectReason.optional() }).optional(),
  }),
  // D62, D64: intake correction, internal hold, order-level reject and per-route supervision.
  z.strictObject({ type: z.literal("treatAsOrder"), role: Role, docId }),
  z.strictObject({ type: z.literal("holdOrder"), role: Role, docId, reason: HoldReason }),
  z.strictObject({ type: z.literal("releaseHold"), role: Role, docId }),
  z.strictObject({ type: z.literal("rejectOrder"), role: Role, docId, reasonCode: RejectReason.nullable() }),
  z.strictObject({ type: z.literal("setRoutePolicy"), role: Role, customerId: z.string().min(1).max(200), channel: Channel,
    mode: z.enum(["review_all", "exception_only"]), reason: shortText.nullable().optional() }),
  // D74: supplier order policies.
  z.strictObject({ type: z.literal("addPolicyRule"), role: Role, check: z.enum(["price_mismatch", "moq_violation"]),
    customerId: z.string().min(1).max(200).nullable(), sku: z.string().min(1).max(200).nullable(),
    tolerancePercent: z.string().regex(/^\d{1,2}(\.\d{1,2})?$/).nullable(), effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), reason: shortText }),
  z.strictObject({ type: z.literal("endPolicyRule"), role: Role, policyId: docId }),
  // D66, D67: proposed Command Center.
  z.strictObject({ type: z.literal("assignFinding"), role: Role, findingId: docId, owner: z.string().max(200).nullable() }),
  z.strictObject({ type: z.literal("setFindingOwnership"), role: Role, findingType: z.union([FindingType, z.literal("order_review")]), owner: z.string().max(200).nullable() }),
  z.strictObject({ type: z.literal("respondToRevision"), messageId: docId, customerId: z.string().min(1).max(200),
    decision: z.enum(["accepted", "declined"]) }),
  z.strictObject({ type: z.literal("approve"), role: Role, docId }),
  // Session onboarding (D46). Values the PO printed are read from the run, not from the action.
  z.strictObject({ type: z.literal("addCustomer"), role: Role, docId, name: z.string().max(200).optional(),
    currency: z.string().regex(/^[A-Za-z]{3}$/).optional() }),
  z.strictObject({ type: z.literal("assignCustomer"), role: Role, docId, customerId: z.string().min(1).max(100) }),
  z.strictObject({ type: z.literal("addShipTo"), role: Role, docId }),
  z.strictObject({ type: z.literal("addProduct"), role: Role, docId, issueKey: z.string().min(1).max(200),
    sku: z.string().max(100).optional(), description: z.string().max(300).optional(),
    moq: z.string().max(40).optional() }),
  z.strictObject({ type: z.literal("retryDelivery"), role: Role, docId }),
  z.strictObject({ type: z.literal("setRuleState"), role: Role, ruleId: docId, state: z.enum(["active", "revoked"]),
    reason: shortText.nullable().optional() }),
  z.strictObject({ type: z.literal("setPolicy"), role: Role, mode: z.string().max(40), reason: shortText.nullable().optional() }),
  z.strictObject({ type: z.literal("setDemoSetting"), role: Role, key: z.enum(["erp_failure_mode", "rehearsal_mode"]),
    value: z.string().max(40) }),
  z.strictObject({ type: z.literal("resetDemo"), role: Role }),
  z.strictObject({ type: z.literal("recoverDeliveries") }),
  // Supplier portal (D45). Quantities are decimal strings; the workflow checks them against the order and ASN.
  z.strictObject({ type: z.literal("submitAsn"), role: Role, docId,
    lines: z.array(z.strictObject({ lineIndex: z.number().int().nonnegative(), shippedQty: z.string().max(40),
      overrideReason: shortText.nullable().optional() })).min(1).max(500),
    // D47: dates and packing.
    despatchDate: z.string().max(20).nullable().optional(),
    estimatedDelivery: z.string().max(20).nullable().optional(),
    carrierScac: z.string().max(10).nullable().optional(), bolNumber: z.string().max(40).nullable().optional(),
    trackingNumber: z.string().max(40).nullable().optional(),
    packing: z.strictObject({ cartonsPerPallet: z.number().int().positive().max(2000).nullable().optional(),
      unitsPerCarton: z.array(z.strictObject({ lineIndex: z.number().int().nonnegative(), units: z.string().max(40) }))
        .max(500).optional() }).optional() }),
  z.strictObject({ type: z.literal("cancelBackorder"), role: Role, docId, reason: z.string().max(400) }),
  // D61: stock and ship dates.
  z.strictObject({ type: z.literal("decideFulfilment"), role: Role, docId, choice: z.enum(["ship_complete", "split", "ship_available"]),
    shipOn: z.string().max(10).nullable().optional() }),
  z.strictObject({ type: z.literal("receiveStock"), role: Role, sku: z.string().max(80), ref: z.string().max(80) }),
  z.strictObject({ type: z.literal("setStock"), role: Role, sku: z.string().min(1).max(80), onHand: z.string().max(20),
    leadTimeDays: z.number().int() }),
  z.strictObject({ type: z.literal("setFulfilmentSettings"), role: Role, settings: z.unknown() }),
  z.strictObject({ type: z.literal("applySupplierReply"), role: Role, docId, text: z.string().max(4000), interpretation: z.unknown() }),
  z.strictObject({ type: z.literal("shipFromErp"), role: Role, docId, carrierScac: z.string().max(4),
    trackingNumber: z.string().min(1).max(40) }),
  z.strictObject({ type: z.literal("submitInvoice"), role: Role, asnId: docId,
    lines: z.array(z.strictObject({ lineIndex: z.number().int().nonnegative(), quantity: z.string().max(40),
      taxRate: z.string().max(20).nullable().optional() })).min(1).max(500),
    // D47: allowances and charges.
    allowances: z.array(z.strictObject({ kind: z.enum(["allowance", "charge"]), code: z.string().max(10),
      description: z.string().max(200).nullable().optional(), percent: z.string().max(20).nullable().optional(),
      amount: z.string().max(40).nullable().optional(), taxRate: z.string().max(20) })).max(20).optional() }),
  // D47: trading partner EDI setup.
  z.strictObject({ type: z.literal("saveSupplierSetup"), role: Role, name: z.string().max(200).nullable().optional(),
    gln: z.string().max(40), vatId: z.string().max(100).nullable().optional(), companyPrefix: z.string().max(20),
    taxType: z.enum(["VAT", "GST", "SALES"]), defaultTaxRate: z.string().max(20).nullable().optional(),
    paymentTerms: z.strictObject({ discountPercent: z.string().max(10).nullable().optional(),
      discountDays: z.number().int().min(0).max(365).nullable().optional(), netDays: z.number().int().min(0).max(365) }).nullable().optional() }),
  z.strictObject({ type: z.literal("saveTradingPartner"), role: Role, customerId: z.string().max(200),
    profile: z.enum(PROFILE_IDS), buyerGln: z.string().max(40).nullable().optional(),
    buyerVatId: z.string().max(100).nullable().optional(), contractRef: z.string().max(100).nullable().optional(),
    vendorNumber: z.string().max(100).nullable().optional(),
    shipToGlns: z.array(z.strictObject({ shipToId: z.string().max(200), gln: z.string().max(40) })).max(50) }),
  z.strictObject({ type: z.literal("retryOutbound"), role: Role, messageId: docId }),
  z.strictObject({ type: z.literal("setEdiFailureMode"), role: Role, value: z.enum(["none", "fail_next", "hold_next"]) }),
  // D49: Act 1 assumptions (checked in full by setManualRouteAssumptions).
  z.strictObject({ type: z.literal("setManualRouteAssumptions"), role: Role,
    values: z.record(z.string().max(40), z.string().max(20)) }),
]);
export type Action = z.infer<typeof Action>;

export type ActionResult =
  | { ok: true; state: RunState; documentIds?: number[] }
  | { ok: false; status: 400 | 403 | 409; error: string };

function apply(s: RunState, a: Action): { state: RunState; documentIds?: number[] } {
  const who = (role: z.infer<typeof Role>): Who => ({ actor: ACTOR[role], role });
  switch (a.type) {
    case "receive":
      return receive(s, a.envelope, a.attachments, INTAKE_ACTOR, undefined, a.email ?? null);
    case "startExtraction":
      return { state: startExtraction(s, a.docId) };
    case "recordExtraction": {
      // The page text the run holds is the source of truth: every value's evidence is checked again here,
      // so a payload cannot claim evidence the stored text does not contain.
      const doc = s.documents.find((d) => d.id === a.docId);
      if (!doc) throw new Conflict("Unknown document");
      // D62: a structured EDI order is read here from the stored file; nothing the browser sends replaces it.
      if (doc.kind === "edi") {
        const edi = read850(doc.pageText);
        if (!edi) return { state: recordExtraction(s, a.docId, normalise({}, doc.pageText, { name: "Structured X12 850 reader (no AI)", isAi: false }),
          undefined, { result: "not_order", reason: "The EDI file holds no purchase order (850)." }) };
        return { state: recordExtraction(s, a.docId, edi, undefined, { result: "order", reason: "Structured purchase order (X12 850)." }) };
      }
      const scan = a.payload.source === "scan" && a.payload.extractor.is_ai && !doc.pageText.some((p) => p.trim()) && a.transcript;
      if (scan) {
        // A scan has no text of its own: the AI's transcription becomes the page text, labelled, and the order
        // always waits for a person (workflow.settle).
        if (a.transcript!.length !== doc.pageText.length) throw new Conflict("The transcription does not match the page count");
        s = { ...s, documents: s.documents.map((d) => (d.id === doc.id ? { ...d, pageText: a.transcript! } : d)) };
      }
      const checked = normalise(a.payload, scan ? a.transcript! : doc.pageText, { name: a.payload.extractor.name, isAi: a.payload.extractor.is_ai });
      if (scan) checked.source = "scan";
      return { state: recordExtraction(s, a.docId, checked, undefined, a.classification ?? null) };
    }
    case "failExtraction":
      return { state: failExtraction(s, a.docId, a.kind, a.detail) };
    case "retryExtraction":
      return { state: retryExtraction(s, a.docId, RETRY_ACTOR) };
    case "decide":
      return { state: decide(s, a.docId, { issueKey: a.issueKey, action: a.action, reason: a.reason ?? null,
        params: a.params ?? {} }, who(a.role)) };
    case "approve":
      return { state: approve(s, a.docId, who(a.role)) };
    case "addCustomer":
      return { state: addCustomer(s, a.docId, { name: a.name, currency: a.currency }, who(a.role)) };
    case "assignCustomer":
      return { state: assignCustomer(s, a.docId, a.customerId, who(a.role)) };
    case "addShipTo":
      return { state: addShipTo(s, a.docId, who(a.role)) };
    case "addProduct":
      return { state: addProduct(s, a.docId, a.issueKey, { sku: a.sku, description: a.description, moq: a.moq },
        who(a.role)) };
    case "retryDelivery":
      return { state: retryDelivery(s, a.docId, who(a.role)) };
    case "setRuleState":
      return { state: setRuleState(s, a.ruleId, a.state, who(a.role), a.reason ?? null) };
    case "setPolicy":
      return { state: setPolicy(s, a.mode, who(a.role), undefined, a.reason ?? null) };
    case "setRoutePolicy":
      return { state: setRoutePolicy(s, a.customerId, a.channel, a.mode, a.reason ?? null, who(a.role)) };
    case "addPolicyRule":
      return { state: addPolicyRule(s, { check: a.check, customerId: a.customerId, sku: a.sku, tolerancePercent: a.tolerancePercent,
        effectiveFrom: a.effectiveFrom, effectiveTo: a.effectiveTo, reason: a.reason }, who(a.role)) };
    case "endPolicyRule":
      return { state: endPolicyRule(s, a.policyId, who(a.role)) };
    case "treatAsOrder":
      return { state: treatAsOrder(s, a.docId, who(a.role)) };
    case "holdOrder":
      return { state: holdOrder(s, a.docId, a.reason, who(a.role)) };
    case "releaseHold":
      return { state: releaseHold(s, a.docId, who(a.role)) };
    case "rejectOrder":
      return { state: rejectOrder(s, a.docId, a.reasonCode, who(a.role)) };
    case "assignFinding":
      return { state: assignFinding(s, a.findingId, a.owner, who(a.role)) };
    case "setFindingOwnership":
      return { state: setFindingOwnership(s, a.findingType, a.owner, who(a.role)) };
    case "respondToRevision":
      return { state: respondToRevision(s, a.messageId, a.customerId, a.decision) };
    case "setDemoSetting":
      return { state: setDemoSetting(s, a.key, a.value, who(a.role)) };
    case "resetDemo":
      return { state: resetDemo(s, who(a.role)) };
    case "recoverDeliveries":
      return { state: recoverDeliveries(s) };
    case "submitAsn":
      return { state: submitAsn(s, a.docId, { lines: a.lines, despatchDate: a.despatchDate,
        estimatedDelivery: a.estimatedDelivery, carrierScac: a.carrierScac, bolNumber: a.bolNumber,
        trackingNumber: a.trackingNumber, packing: a.packing }, who(a.role)) };
    case "applySupplierReply":
      return { state: applySupplierReply(s, a.docId, a.text, a.interpretation, who(a.role)) };
    case "shipFromErp":
      return { state: shipFromErp(s, a.docId, { carrierScac: a.carrierScac, trackingNumber: a.trackingNumber }, who(a.role)) };
    case "decideFulfilment":
      return { state: decideFulfilment(s, a.docId, { choice: a.choice, shipOn: a.shipOn ?? null }, who(a.role)) };
    case "receiveStock":
      return { state: receiveStock(s, a.sku, a.ref, who(a.role)) };
    case "setStock":
      return { state: setStock(s, a.sku, { onHand: a.onHand, leadTimeDays: a.leadTimeDays }, who(a.role)) };
    case "setFulfilmentSettings":
      return { state: setFulfilmentSettings(s, a.settings, who(a.role)) };
    case "cancelBackorder":
      return { state: cancelBackorder(s, a.docId, a.reason, who(a.role)) };
    case "submitInvoice":
      return { state: submitInvoice(s, a.asnId, { lines: a.lines, allowances: a.allowances }, who(a.role)) };
    case "saveSupplierSetup": {
      const { type: _t, role, ...input } = a;
      return { state: saveSupplierSetup(s, input, who(role)) };
    }
    case "saveTradingPartner": {
      const { type: _t, role, ...input } = a;
      return { state: saveTradingPartner(s, input, who(role)) };
    }
    case "retryOutbound":
      return { state: retryOutbound(s, a.messageId, who(a.role)) };
    case "setEdiFailureMode":
      return { state: setEdiFailureMode(s, a.value, who(a.role)) };
    case "setManualRouteAssumptions":
      return { state: setManualRouteAssumptions(s, a.values, who(a.role)) };
  }
}

export function applyAction(state: unknown, action: unknown): ActionResult {
  const s = RunState.safeParse(state);
  if (!s.success) return { ok: false, status: 400, error: "The run in this tab is not in the expected format. Reset the demo." };
  const a = Action.safeParse(action);
  if (!a.success) return { ok: false, status: 400, error: "That action is not in the expected format." };
  try {
    const out = apply(s.data, a.data);
    // D66: findings follow every change to the run's records.
    return { ok: true, ...out, state: reconcileFindings(out.state) };
  } catch (exc) {
    if (exc instanceof Forbidden) return { ok: false, status: 403, error: exc.message };
    if (exc instanceof Conflict) return { ok: false, status: 409, error: exc.message };
    throw exc;
  }
}
