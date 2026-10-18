// D74: supplier order policies. Set by an administrator, scoped by customer and item, dated, audited, and applied
// only to orders received after they were created. They record a decision the way a person would, never silently.
import { describe, expect, it, vi } from "vitest";
import { EMAILS, type DemoName } from "../domain/__fixtures__/demo";
import { type RunState, emptyRunState } from "../domain/run-state";
import { extractPages } from "./extract/run";
import { type Action, type ActionResult, applyAction } from "./run-action";
import { loadExtractionConfig } from "./config";

const must = (r: ActionResult): RunState => { if (!r.ok) throw new Error(`${r.status} ${r.error}`); return r.state; };
const go = (s: RunState, a: Action) => must(applyAction(s, a));
async function forward(s: RunState, name: DemoName): Promise<RunState> {
  const email = EMAILS[name];
  const received = applyAction(s, { type: "receive", envelope: email.envelope, attachments: email.attachments });
  let next = must(received);
  for (const docId of received.ok ? received.documentIds! : []) {
    const doc = next.documents.find((d) => d.id === docId)!;
    next = must(applyAction(next, { type: "startExtraction", docId }));
    const outcome = await extractPages(doc.pageText, { rehearsal: true, config: loadExtractionConfig({}) });
    next = must(applyAction(next, outcome.ok ? { type: "recordExtraction", docId, payload: outcome.payload }
      : { type: "failExtraction", docId, kind: outcome.status, detail: outcome.detail }));
  }
  return next;
}
const price = (tol: string, extra: Partial<Extract<Action, { type: "addPolicyRule" }>> = {}): Action => ({ type: "addPolicyRule",
  role: "administrator", check: "price_mismatch", customerId: "DEMO-CUST-01", sku: null, tolerancePercent: tol,
  effectiveFrom: "2026-10-01", effectiveTo: null, reason: "Promotional prices within tolerance are accepted (fictional)", ...extra });
const open = (s: RunState, docId: number) => s.orders.find((o) => o.documentId === docId)!.validation.issues
  .filter((i) => i.status === "open").map((i) => i.code);

describe("order policies (D74)", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T15:00:00.000Z"));
  const base = go(go(emptyRunState(), { type: "resetDemo", role: "administrator" }),
    { type: "setDemoSetting", role: "administrator", key: "rehearsal_mode", value: "on" });

  it("accepts a price within tolerance as a recorded, audited decision", async () => {
    // VIDEO-DEMO-001 line B: printed 26.00, agreed 24.00 (8.33%).
    const s = await forward(go(base, price("10")), "VIDEO-DEMO-001");
    expect(open(s, 1)).not.toContain("price_mismatch");
    expect(open(s, 1)).toContain("moq_violation");
    const d = s.decisions.find((x) => x.issueKey === "price_mismatch:1")!;
    expect(d).toMatchObject({ action: "accept_printed_price", actor: "policy:P-1", reason: expect.stringContaining("Policy P-1") });
    expect(s.audit.some((a) => a.event === "policy_applied" && a.actor === "policy:P-1")).toBe(true);
    expect(s.audit.some((a) => a.event === "order_policy_added")).toBe(true);
  });

  it("does not apply outside its tolerance, scope or dates", async () => {
    expect(open(await forward(go(base, price("5")), "VIDEO-DEMO-001"), 1)).toContain("price_mismatch");
    expect(open(await forward(go(base, price("10", { customerId: "OTHER" })), "VIDEO-DEMO-001"), 1)).toContain("price_mismatch");
    expect(open(await forward(go(base, price("10", { effectiveTo: "2026-10-10" })), "VIDEO-DEMO-001"), 1)).toContain("price_mismatch");
  });

  it("applies only to orders received after it was created, and stops when ended", async () => {
    const before = await forward(base, "VIDEO-DEMO-001");
    const after = go(before, price("10"));
    expect(open(after, 1)).toContain("price_mismatch");
    const ended = go(after, { type: "endPolicyRule", role: "administrator", policyId: 1 });
    expect(ended.policyRules![0].endedAt).not.toBeNull();
  });

  it("only an administrator sets a policy, with a reason and a sane tolerance", () => {
    expect(applyAction(base, { ...price("10"), role: "reviewer" } as Action).ok).toBe(false);
    expect(applyAction(base, price("10", { reason: "" })).ok).toBe(false);
    expect(applyAction(base, price("50")).ok).toBe(false);
  });

  it("a policy decision alone still lets an order go through automatically", async () => {
    let s = go(base, { type: "setPolicy", role: "administrator", mode: "exception_only", reason: "Pilot evidence reviewed" });
    s = go(s, price("10"));
    s = go(s, { type: "addPolicyRule", role: "administrator", check: "moq_violation", customerId: "DEMO-CUST-01", sku: null,
      tolerancePercent: null, effectiveFrom: "2026-10-01", effectiveTo: null, reason: "Trial quantities accepted (fictional)" });
    s = await forward(s, "VIDEO-DEMO-001");
    // The retired GTIN still needs a person, so the order waits; policy decisions are not counted as a person's.
    expect(open(s, 1)).toEqual(["outdated_identifier"]);
  });
});

describe("revised PO in the five-order demo (D74)", () => {
  it("a second email with the same PO number is held as a revision and then updates the same ERP order", async () => {
    let s = go(go(emptyRunState(), { type: "resetDemo", role: "administrator" }),
      { type: "setDemoSetting", role: "administrator", key: "rehearsal_mode", value: "on" });
    s = go(s, { type: "setPolicy", role: "administrator", mode: "exception_only", reason: "Pilot evidence reviewed" });
    s = await forward(s, "VIDEO-DEMO-005");
    expect(s.orders[0].erpOrderId).not.toBeNull();
    s = await forward(s, "VIDEO-DEMO-006");
    expect(open(s, 2)).toEqual(["possible_revision"]);
    s = go(s, { type: "decide", role: "reviewer", docId: 2, issueKey: "possible_revision:H", action: "accept_as_revision",
      reason: "Buyer sent revision 2 (fictional)" });
    const o = s.orders.find((x) => x.documentId === 2)!;
    const first = s.orders.find((x) => x.documentId === 1)!;
    expect(o).toMatchObject({ deliveryState: "erp_created", erpOrderId: first.erpOrderId });
    expect(new Set(s.erpOrders.map((e) => e.erpOrderId)).size).toBe(1);
    expect(s.audit.some((x) => x.event === "erp_order_revised")).toBe(true);
  });
});
