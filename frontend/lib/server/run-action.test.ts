// Rebuild slice 5: the server action behind every screen action. The guided demo performed the way the screens
// perform it (one action per call, the run sent along each time) gives the same run as the workflow replay,
// and the server refuses what it should, with the reason as a value rather than a thrown error.
import { describe, expect, it } from "vitest";
import { runAction } from "../../app/actions/run";
import { EMAILS, type DemoName, maskTimes } from "../domain/__fixtures__/demo";
import { replayGuidedDemo } from "../domain/__fixtures__/replay";
import { FIXTURE_EXTRACTOR, fixtureExtract } from "../domain/extract/fixture";
import { normalise } from "../domain/normalise";
import { type RunState, emptyRunState } from "../domain/run-state";
import { extractPages } from "./extract/run";
import { type Action, type ActionResult, applyAction } from "./run-action";
import { loadExtractionConfig } from "./config";

function must(r: ActionResult): RunState {
  if (!r.ok) throw new Error(`${r.status} ${r.error}`);
  return r.state;
}

/** What the browser does for a forwarded demo email: receive, then for each new document extract and record. */
async function forward(s: RunState, name: DemoName): Promise<RunState> {
  const email = EMAILS[name];
  const received = applyAction(s, { type: "receive", envelope: email.envelope, attachments: email.attachments });
  let next = must(received);
  for (const docId of received.ok ? received.documentIds! : []) {
    const doc = next.documents.find((d) => d.id === docId)!;
    if (doc.status !== "received") continue;
    next = must(applyAction(next, { type: "startExtraction", docId }));
    const outcome = await extractPages(doc.pageText, { rehearsal: true, config: loadExtractionConfig({}) });
    next = must(applyAction(next, outcome.ok ? { type: "recordExtraction", docId, payload: outcome.payload }
      : { type: "failExtraction", docId, kind: outcome.status, detail: outcome.detail }));
  }
  return next;
}

const go = (s: RunState, a: Action) => must(applyAction(s, a));

describe("the guided demo through the server action", () => {
  it("gives the same run as the workflow replay, timestamps aside", async () => {
    let s = go(emptyRunState(), { type: "resetDemo", role: "administrator" });
    s = go(s, { type: "setDemoSetting", role: "administrator", key: "rehearsal_mode", value: "on" });
    s = go(s, { type: "setPolicy", role: "administrator", mode: "exception_only" });
    s = await forward(s, "VIDEO-DEMO-001");
    s = go(s, { type: "decide", role: "reviewer", docId: 1, issueKey: "moq_violation:0", action: "one_off_exception",
      reason: "Customer confirmed a one-off trial quantity (fictional)" });
    s = go(s, { type: "decide", role: "reviewer", docId: 1, issueKey: "price_mismatch:1", action: "accept_printed_price",
      reason: "Promotional price agreed by the account manager (fictional)" });
    s = go(s, { type: "decide", role: "reviewer", docId: 1, issueKey: "outdated_identifier:2", action: "apply_mapping",
      reason: null, params: { save_for_future: true } });
    s = go(s, { type: "setRuleState", role: "administrator", ruleId: 1, state: "active" });
    s = await forward(s, "VIDEO-DEMO-002");
    s = await forward(s, "VIDEO-DEMO-003");
    s = go(s, { type: "setRuleState", role: "administrator", ruleId: 1, state: "revoked",
      reason: "Supplier withdrew the notice (fictional)" });
    s = await forward(s, "VIDEO-DEMO-004");
    s = go(s, { type: "setPolicy", role: "administrator", mode: "review_all" });
    s = await forward(s, "VIDEO-DEMO-005");
    s = go(s, { type: "setDemoSetting", role: "administrator", key: "erp_failure_mode", value: "timeout_next" });
    s = go(s, { type: "approve", role: "reviewer", docId: 5 });
    s = go(s, { type: "retryDelivery", role: "reviewer", docId: 5 });
    s = await forward(s, "VIDEO-DEMO-005");
    expect(maskTimes(s)).toStrictEqual(maskTimes(replayGuidedDemo()));
    expect(s.erpOrders).toHaveLength(3);
  });

  it("the exported server action is the same function", async () => {
    const s = emptyRunState();
    expect(await runAction(s, { type: "setPolicy", role: "administrator", mode: "exception_only" }))
      .toMatchObject({ ok: true, state: { policyHistory: [{ mode: "review_all" }, { mode: "exception_only" }] } });
  });
});

describe("the server action refuses", () => {
  const s = emptyRunState();
  it("a run that is not a RunState", () => {
    for (const bad of [null, "x", {}, { ...s, extra: 1 }, { ...s, schemaVersion: "v0" }]) {
      expect(applyAction(bad, { type: "recoverDeliveries" })).toMatchObject({ ok: false, status: 400 });
    }
  });

  it("an action that is not in the list or has extra fields", () => {
    for (const bad of [null, { type: "dropTables" }, { type: "setPolicy", role: "root", mode: "exception_only" },
      { type: "setPolicy", role: "administrator", mode: "exception_only", actor: "administrator:mallory" },
      { type: "receive", envelope: {}, attachments: [] }]) {
      expect(applyAction(s, bad)).toMatchObject({ ok: false, status: 400 });
    }
  });

  it("a role that may not act (403), with the workflow's message", () => {
    expect(applyAction(s, { type: "setPolicy", role: "reviewer", mode: "exception_only" }))
      .toStrictEqual({ ok: false, status: 403, error: "Only an administrator can change the automation mode" });
    expect(applyAction(s, { type: "resetDemo", role: "viewer" })).toMatchObject({ ok: false, status: 403 });
  });

  it("a decision without a reason (409), so the screen can say why", async () => {
    const run = await forward(go(s, { type: "setDemoSetting", role: "administrator", key: "rehearsal_mode", value: "on" }),
      "VIDEO-DEMO-001");
    const r = applyAction(run, { type: "decide", role: "reviewer", docId: 1, issueKey: "moq_violation:0",
      action: "one_off_exception", reason: null });
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(!r.ok && r.error).toContain("reason is required");
  });

  it("never changes the run it was given", async () => {
    const before = structuredClone(s);
    go(s, { type: "setPolicy", role: "administrator", mode: "exception_only" });
    expect(s).toStrictEqual(before);
  });
});

describe("extraction results are checked again against the run's page text", () => {
  it("a payload claiming evidence the text does not contain is stored as unverified", async () => {
    let run = go(emptyRunState(), { type: "receive", envelope: EMAILS["VIDEO-DEMO-001"].envelope,
      attachments: EMAILS["VIDEO-DEMO-001"].attachments });
    run = go(run, { type: "startExtraction", docId: 1 });
    const pages = run.documents[0].pageText;
    const payload = normalise(fixtureExtract(pages), pages, { name: FIXTURE_EXTRACTOR.name, isAi: false });
    payload.header.total = { value: "999.99", page: 1, evidence: "Total: 999.99", evidence_verified: true, notes: [] };
    run = go(run, { type: "recordExtraction", docId: 1, payload });
    expect(run.versions[0].payload.header.total).toStrictEqual(
      { value: "999.99", page: 1, evidence: "Total: 999.99", evidence_verified: false, notes: ["value not found in source text"] });
  });

  it("re-checking an honest result changes nothing, for every demo email", () => {
    for (const email of Object.values(EMAILS)) {
      for (const att of email.attachments) {
        const once = normalise(fixtureExtract(att.pageText), att.pageText, { name: FIXTURE_EXTRACTOR.name, isAi: false });
        expect(normalise(once, att.pageText, { name: FIXTURE_EXTRACTOR.name, isAi: false })).toStrictEqual(once);
      }
    }
  });

  it("a result for a document that is not being extracted is refused", () => {
    const run = go(emptyRunState(), { type: "receive", envelope: EMAILS["VIDEO-DEMO-001"].envelope,
      attachments: EMAILS["VIDEO-DEMO-001"].attachments });
    const pages = run.documents[0].pageText;
    const payload = normalise(fixtureExtract(pages), pages, { name: FIXTURE_EXTRACTOR.name, isAi: false });
    expect(applyAction(run, { type: "recordExtraction", docId: 1, payload }))
      .toStrictEqual({ ok: false, status: 409, error: "Document is not being extracted" });
  });
});

describe("supplier portal actions (D45)", () => {
  const lines = [{ lineIndex: 0, shippedQty: "4" }, { lineIndex: 1, shippedQty: "2" }, { lineIndex: 2, shippedQty: "1" }];
  it("submits an ASN and its invoice through the server action", () => {
    let s = must(applyAction(replayGuidedDemo(), { type: "submitAsn", role: "reviewer", docId: 1, lines }));
    const asnId = s.portal!.asns[0].id;
    s = must(applyAction(s, { type: "submitInvoice", role: "reviewer", asnId,
      lines: [{ lineIndex: 0, quantity: "4" }, { lineIndex: 1, quantity: "2" }, { lineIndex: 2, quantity: "1" }] }));
    // Lines 166.00; the fictional US demo supplier charges no sales tax by default.
    expect([s.portal!.invoices[0].subtotal, s.portal!.invoices[0].total]).toStrictEqual(["166.00", "166.00"]);
    expect(s.portal!.outbound.find((m) => m.kind === "DESADV")!.body).toMatch(/^MAN\*GM\*\d{18}~$/m);
  });
  it("refuses extra fields, a number instead of a decimal string, and an over-shipment without a reason", () => {
    const run = replayGuidedDemo();
    expect(applyAction(run, { type: "submitAsn", role: "reviewer", docId: 1, lines, sendNow: true }))
      .toMatchObject({ ok: false, status: 400 });
    expect(applyAction(run, { type: "submitAsn", role: "reviewer", docId: 1, lines: [{ lineIndex: 0, shippedQty: 4 }] }))
      .toMatchObject({ ok: false, status: 400 });
    expect(applyAction(run, { type: "submitAsn", role: "reviewer", docId: 1,
      lines: [{ lineIndex: 0, shippedQty: "9" }, ...lines.slice(1)] })).toMatchObject({ ok: false, status: 409 });
    expect(applyAction(run, { type: "submitAsn", role: "viewer", docId: 1, lines })).toMatchObject({ ok: false, status: 403 });
  });
  it("saves the EDI setup (D47) and refuses a bad GLN or a viewer", () => {
    const run = replayGuidedDemo();
    const sup = { type: "saveSupplierSetup", role: "reviewer", gln: "9520000005559", companyPrefix: "9520000", taxType: "VAT",
      defaultTaxRate: "19" };
    const s = must(applyAction(run, sup));
    expect(s.portal!.supplier).toMatchObject({ gln: "9520000005559", taxType: "VAT", updatedBy: "reviewer:rita" });
    expect(applyAction(run, { ...sup, gln: "9520000005558" })).toMatchObject({ ok: false, status: 409 });
    expect(applyAction(run, { ...sup, role: "viewer" })).toMatchObject({ ok: false, status: 403 });
    const partner = { type: "saveTradingPartner", role: "reviewer", customerId: "DEMO-CUST-01", profile: "eancom2002",
      buyerGln: "9520010007772", shipToGlns: [{ shipToId: "DEMO-DC-01", gln: "9520020007779" }] };
    expect(must(applyAction(s, partner)).portal!.partners).toHaveLength(1);
    expect(applyAction(s, { ...partner, profile: "made_up" })).toMatchObject({ ok: false, status: 400 });
  });
});
