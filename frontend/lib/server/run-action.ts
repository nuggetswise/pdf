// The server half of every screen action (rebuild slice 5). The browser sends the whole run and one action;
// the server checks both, runs the workflow function and returns the next run. Nothing is kept on the server.
// Errors come back as values: Next masks errors thrown from server actions in production.
import "server-only";
import { z } from "zod";
import { MAX_PAGES } from "../intake/pdf";
import { normalise } from "../domain/normalise";
import { DecisionAction, ExtractionPayload, IntakeMode, RunState } from "../domain/run-state";
import {
  Conflict, Forbidden, type Who, addCustomer, addProduct, addShipTo, approve, assignCustomer, decide, failExtraction, receive, recordExtraction, recoverDeliveries,
  resetDemo, retryDelivery, retryExtraction, setDemoSetting, setPolicy, setRuleState, startExtraction,
} from "../domain/workflow";
import { retryOutbound, setEdiFailureMode, submitAsn, submitInvoice } from "../domain/portal";

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
}).refine((a) => a.pageText.length === a.pageCount, "pageText must have one entry per page");

export const Action = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("receive"),
    envelope: z.strictObject({
      messageId: shortText.nullable(), sender: shortText.nullable(), receivedAt: shortText.nullable(),
      subjectMetadata: shortText.nullable(), intakeMode: IntakeMode, rawSha256: sha.nullable(),
    }),
    attachments: z.array(Attachment).min(1).max(20),
  }),
  z.strictObject({ type: z.literal("startExtraction"), docId }),
  z.strictObject({ type: z.literal("recordExtraction"), docId, payload: ExtractionPayload }),
  z.strictObject({ type: z.literal("failExtraction"), docId,
    kind: z.enum(["unsupported", "extraction_unavailable", "extraction_failed"]), detail: z.string().min(1).max(500) }),
  z.strictObject({ type: z.literal("retryExtraction"), docId }),
  z.strictObject({
    type: z.literal("decide"), role: Role, docId, issueKey: z.string().min(1).max(200), action: DecisionAction,
    reason: shortText.nullable().optional(),
    params: z.strictObject({ sku: z.string().max(100).optional(), save_for_future: z.boolean().optional(),
      value: z.string().max(100).optional(), note: shortText.optional() }).optional(),
  }),
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
  z.strictObject({ type: z.literal("setPolicy"), role: Role, mode: z.string().max(40) }),
  z.strictObject({ type: z.literal("setDemoSetting"), role: Role, key: z.enum(["erp_failure_mode", "rehearsal_mode"]),
    value: z.string().max(40) }),
  z.strictObject({ type: z.literal("resetDemo"), role: Role }),
  z.strictObject({ type: z.literal("recoverDeliveries") }),
  // Supplier portal (D45). Quantities are decimal strings; the workflow checks them against the order and ASN.
  z.strictObject({ type: z.literal("submitAsn"), role: Role, docId,
    lines: z.array(z.strictObject({ lineIndex: z.number().int().nonnegative(), shippedQty: z.string().max(40),
      overrideReason: shortText.nullable().optional() })).min(1).max(500) }),
  z.strictObject({ type: z.literal("submitInvoice"), role: Role, asnId: docId,
    lines: z.array(z.strictObject({ lineIndex: z.number().int().nonnegative(), quantity: z.string().max(40) }))
      .min(1).max(500) }),
  z.strictObject({ type: z.literal("retryOutbound"), role: Role, messageId: docId }),
  z.strictObject({ type: z.literal("setEdiFailureMode"), role: Role, value: z.enum(["none", "fail_next", "hold_next"]) }),
]);
export type Action = z.infer<typeof Action>;

export type ActionResult =
  | { ok: true; state: RunState; documentIds?: number[] }
  | { ok: false; status: 400 | 403 | 409; error: string };

function apply(s: RunState, a: Action): { state: RunState; documentIds?: number[] } {
  const who = (role: z.infer<typeof Role>): Who => ({ actor: ACTOR[role], role });
  switch (a.type) {
    case "receive":
      return receive(s, a.envelope, a.attachments, INTAKE_ACTOR);
    case "startExtraction":
      return { state: startExtraction(s, a.docId) };
    case "recordExtraction": {
      // The page text the run holds is the source of truth: every value's evidence is checked again here,
      // so a payload cannot claim evidence the stored text does not contain.
      const doc = s.documents.find((d) => d.id === a.docId);
      if (!doc) throw new Conflict("Unknown document");
      const checked = normalise(a.payload, doc.pageText, { name: a.payload.extractor.name, isAi: a.payload.extractor.is_ai });
      return { state: recordExtraction(s, a.docId, checked) };
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
      return { state: setPolicy(s, a.mode, who(a.role)) };
    case "setDemoSetting":
      return { state: setDemoSetting(s, a.key, a.value, who(a.role)) };
    case "resetDemo":
      return { state: resetDemo(s, who(a.role)) };
    case "recoverDeliveries":
      return { state: recoverDeliveries(s) };
    case "submitAsn":
      return { state: submitAsn(s, a.docId, { lines: a.lines }, who(a.role)) };
    case "submitInvoice":
      return { state: submitInvoice(s, a.asnId, { lines: a.lines }, who(a.role)) };
    case "retryOutbound":
      return { state: retryOutbound(s, a.messageId, who(a.role)) };
    case "setEdiFailureMode":
      return { state: setEdiFailureMode(s, a.value, who(a.role)) };
  }
}

export function applyAction(state: unknown, action: unknown): ActionResult {
  const s = RunState.safeParse(state);
  if (!s.success) return { ok: false, status: 400, error: "The run in this tab is not in the expected format. Reset the demo." };
  const a = Action.safeParse(action);
  if (!a.success) return { ok: false, status: 400, error: "That action is not in the expected format." };
  try {
    return { ok: true, ...apply(s.data, a.data) };
  } catch (exc) {
    if (exc instanceof Forbidden) return { ok: false, status: 403, error: exc.message };
    if (exc instanceof Conflict) return { ok: false, status: 409, error: exc.message };
    throw exc;
  }
}
