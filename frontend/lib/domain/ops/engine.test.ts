import { describe, expect, it } from "vitest";
import {
  acknowledgement, approveAndSend, ORDER_RULES, canUndo, counts, decide, OpsRefused, primaryIssue, receiveSample, seedInbox, undoDecision,
} from "./engine";
import { ln, po, SAMPLES, type SampleEmail } from "./samples";
import { OPS_SCHEMA, type Actor, type OpsOrder, type OpsState } from "./types";

const NOW = "2026-10-17T15:00:00.000Z";
const LATER = "2026-10-17T15:05:00.000Z";
const LATEST = "2026-10-17T15:10:00.000Z";
const RITA: Actor = { kind: "person", name: "Rita, order desk" };
const order = (s: OpsState, id: string) => s.orders.find((o) => o.id === id)!;
const byPo = (s: OpsState, n: string) => s.orders.filter((o) => o.po.poNumber === n).at(-1)!;
/** The rules are general: a PO built here goes through the same checks as the bundled samples. */
function inbox(...pos: SampleEmail["po"][]): OpsState {
  const orders: OpsOrder[] = [];
  pos.forEach((p, i) => {
    const b = SAMPLES.find((x) => x.po.buyerName === p.buyerName)!;
    const o = receiveSample({ ...b, id: `ord-90${i + 1}`, minutesAgo: 60 - i, po: p, scenario: "test" }, NOW, orders);
    if (o) orders.push(o);
  });
  return { schema: OPS_SCHEMA, seededAt: NOW, orders };
}

describe("sample inbox", () => {
  const s = seedInbox(NOW);

  it("processes most orders automatically and holds the rest with a reason", () => {
    expect(counts(s)).toEqual({ received: 18, automatic: 14, afterReview: 0, needsReview: 3, blocked: 0, rejected: 1, inProgress: 0 });
  });

  it("is deterministic", () => {
    expect(seedInbox(NOW)).toEqual(s);
  });

  it("straight-through order reaches accepted with the full trail and no person", () => {
    const o = byPo(s, "HV-88190");
    expect(o.state).toBe("accepted");
    expect(o.erp.erpOrderId).toBe("SIM-SO-61001");
    expect(o.decisions).toHaveLength(0);
    expect(o.history.map((e) => e.type)).toEqual(["received", "pdf_identified", "extracted", "buyer_matched", "products_matched",
      "validated", "structured", "erp_sent", "erp_response", "erp_accepted"]);
    expect(o.history.some((e) => e.actor.kind === "person")).toBe(false);
    expect(Object.values(o.header).every((f) => f.state === "accepted")).toBe(true);
  });

  it("classifies each exception scenario into its own state and issue type", () => {
    expect(byPo(s, "SG-55120").state).toBe("needs_review");
    expect(primaryIssue(byPo(s, "SG-55120"))).toMatchObject({ type: "correctable_discrepancy", owner: "Planning", rule: { id: "R8" } });
    expect(byPo(s, "HV-88220").state).toBe("needs_review");
    expect(primaryIssue(byPo(s, "HV-88220"))).toMatchObject({ type: "revision", owner: "Order desk", rule: { id: "R9" } });
    expect(primaryIssue(byPo(s, "LF-20419"))).toMatchObject({ owner: "Pricing", title: "Order uses the previous price list" });
    expect(byPo(s, "SG-55134").state).toBe("rejected");
    expect(primaryIssue(byPo(s, "SG-55134"))?.type).toBe("downstream_rejection");
    expect(byPo(s, "LF-20419").state).toBe("needs_review");
  });
});

describe("recommended correction (unit of measure, built PO)", () => {
  const s0 = inbox(po("SUMMIT", "SG-90001", "SG-DC03", "2026-10-16", "2026-10-26", [ln(1, "NB-2001", "Sparkling Water Lemon 355 mL", "24", "CASE", "9.60"),
    ln(2, "NB-5001", "Ginger Ale 355 mL x 24", "10", "CASE", "14.10")]));
  const id = byPo(s0, "SG-90001").id;
  const iss = primaryIssue(order(s0, id))!;

  it("shows original, expected and proposed values with evidence", () => {
    expect(iss.original).toBe("24 CASE");
    expect(iss.expected).toBe("24 EA");
    expect(iss.proposed).toBe("EA");
    expect(iss.evidence.map((e) => e.kind)).toEqual(["source", "reference", "reference", "history"]);
    expect(iss.agentNote).toContain("has no CASE unit");
    expect(order(s0, id).lines[0].fields.unit.state).toBe("uncertain");
  });

  it("accepting updates the field and history, and waits for one approval that sends", () => {
    const s1 = decide(s0, id, iss.id, { outcome: "accepted_recommendation" }, RITA, LATER);
    const o1 = order(s1, id);
    expect(o1.lines[0].fields.unit).toMatchObject({ value: "EA", state: "changed" });
    expect(o1.state).toBe("ready_to_send");
    expect(o1.history.find((e) => e.type === "decision")).toMatchObject({ actor: RITA, issueId: iss.id });
    const s2 = approveAndSend(s1, id, RITA, LATER);
    expect(order(s2, id).state).toBe("accepted");
    expect(order(s2, id).erp.attempts[0].request.lines[0].unit).toBe("EA");
    expect(order(s2, id).history.find((e) => e.type === "acknowledgement")?.text).toContain("line 1 unit confirmed as EA (PO shows CASE)");
    expect(counts(s2).afterReview).toBe(1);
  });

  it("rejecting keeps the original and shows the honest consequence", () => {
    const s1 = decide(s0, id, iss.id, { outcome: "rejected_recommendation" }, RITA, LATER);
    const o1 = order(s1, id);
    expect(o1.lines[0].fields.unit.value).toBe("CASE");
    expect(o1.state).toBe("needs_review");
    expect(primaryIssue(o1)?.type).toBe("validation_failure");
    expect(() => approveAndSend(s1, id, RITA, LATER)).toThrow(OpsRefused);
  });

  it("undo restores the prior review state", () => {
    const s1 = decide(s0, id, iss.id, { outcome: "accepted_recommendation" }, RITA, LATER);
    const d = order(s1, id).decisions[0];
    expect(canUndo(order(s1, id), d)).toBe(true);
    const s2 = undoDecision(s1, id, d.id, RITA, LATEST);
    const o2 = order(s2, id);
    expect(o2.state).toBe("needs_review");
    expect(o2.lines[0].fields.unit).toMatchObject({ value: "CASE", state: "uncertain" });
    expect(o2.issues.find((i) => i.id === iss.id)?.status).toBe("open");
    expect(o2.history.at(-2)?.type).toBe("decision_undone");
  });

  it("does not allow undo after the order was sent", () => {
    const s1 = approveAndSend(decide(s0, id, iss.id, { outcome: "accepted_recommendation" }, RITA, LATER), id, RITA, LATER);
    const d = order(s1, id).decisions[0];
    expect(canUndo(order(s1, id), d)).toBe(false);
    expect(() => undoDecision(s1, id, d.id, RITA, LATEST)).toThrow(OpsRefused);
  });
});

describe("genuine ambiguity (built PO)", () => {
  const s0 = inbox(po("HARBORVIEW", "HV-90002", "HV-DC1", "2026-10-16", "2026-10-29", [ln(1, null, "Fizz Zero 24 Pack", "40", "CASE", "16.80")]));
  const id = byPo(s0, "HV-90002").id;
  const iss = primaryIssue(order(s0, id))!;

  it("lists both items, recommends neither and cannot continue without a selection", () => {
    expect(iss.options.map((o) => o.value)).toEqual(["NB-1001", "NB-1002"]);
    expect(iss.options.some((o) => o.recommended)).toBe(false);
    expect(iss.proposed).toBeNull();
    expect(() => approveAndSend(s0, id, RITA, LATER)).toThrow(OpsRefused);
    expect(() => decide(s0, id, iss.id, { outcome: "accepted_recommendation" }, RITA, LATER)).toThrow(OpsRefused);
  });

  it("selection reruns validation and the order continues", () => {
    const s1 = decide(s0, id, iss.id, { outcome: "selected_option", optionId: "NB-1002" }, RITA, LATER);
    expect(order(s1, id).lines[0].fields.sku).toMatchObject({ value: "NB-1002", state: "changed" });
    expect(order(s1, id).state).toBe("ready_to_send");
    expect(order(approveAndSend(s1, id, RITA, LATER), id).state).toBe("accepted");
  });
});

describe("blocked order (built PO)", () => {
  const s0 = inbox(po("PRAIRIE", "PF-90003", "none", "2026-10-17", "2026-10-30", [ln(1, "NB-6001", "Iced Tea Peach 500 mL x 12", "20", "CASE", "11.25")]));
  const id = byPo(s0, "PF-90003").id;
  const iss = primaryIssue(order(s0, id))!;

  it("cannot be sent and offers no automatic fix", () => {
    expect(iss.proposed).toBeNull();
    expect(iss.options.every((o) => !o.recommended)).toBe(true);
    expect(order(s0, id).header.delivery_location.state).toBe("missing");
    expect(() => approveAndSend(s0, id, RITA, LATER)).toThrow(OpsRefused);
    expect(order(s0, id).erp.attempts).toHaveLength(0);
  });

  it("deferring keeps it blocked; a buyer-confirmed value unblocks it", () => {
    const s1 = decide(s0, id, iss.id, { outcome: "deferred" }, RITA, LATER);
    expect(order(s1, id).state).toBe("blocked");
    expect(order(s1, id).header.delivery_location.note).toBe("Waiting on the buyer");
    expect(() => decide(s1, id, iss.id, { outcome: "corrected_value", value: "PF-DC1", confirmedByBuyer: false }, RITA, LATER)).toThrow(OpsRefused);
    const s2 = decide(s1, id, iss.id, { outcome: "corrected_value", value: "PF-DC1", confirmedByBuyer: true }, RITA, LATEST);
    expect(order(s2, id).state).toBe("ready_to_send");
    expect(order(approveAndSend(s2, id, RITA, LATEST), id).state).toBe("accepted");
  });
});

describe("downstream rejection", () => {
  const s0 = seedInbox(NOW);
  const id = byPo(s0, "SG-55134").id;
  const iss = primaryIssue(order(s0, id))!;

  it("passed the agent's checks, was sent automatically and rejected by the ERP", () => {
    const o = order(s0, id);
    expect(o.history.some((e) => e.type === "validated" && e.text.includes("All checks passed"))).toBe(true);
    expect(o.erp.attempts[0].response).toMatchObject({ status: "rejected", code: "SHIPTO_INACTIVE", field: "delivery_location" });
    expect(iss.proposed).toBe("SG-DC14N");
    expect(o.header.delivery_location.state).toBe("invalid");
  });

  it("can be corrected and retried, and the ERP accepts the corrected order", () => {
    const s1 = decide(s0, id, iss.id, { outcome: "selected_option", optionId: "SG-DC14N" }, RITA, LATER);
    expect(order(s1, id).state).toBe("ready_to_send");
    const s2 = approveAndSend(s1, id, RITA, LATER);
    const o = order(s2, id);
    expect(o.state).toBe("accepted");
    expect(o.erp.attempts).toHaveLength(2);
    expect(o.erp.attempts[1].request.shipTo).toBe("SG-DC14N");
    expect(o.issues.find((i) => i.id === iss.id)?.status).toBe("resolved");
  });
});

describe("rejected recommendation (price)", () => {
  const s0 = seedInbox(NOW);
  const id = byPo(s0, "LF-20419").id;
  const iss = primaryIssue(order(s0, id))!;

  it("keeping the printed price is recorded and the outcome is shown honestly", () => {
    expect(iss.proposed).toBe("18.50");
    const s1 = decide(s0, id, iss.id, { outcome: "rejected_recommendation" }, RITA, LATER);
    const o1 = order(s1, id);
    expect(o1.lines[0].fields.unit_price.value).toBe("18.75");
    expect(o1.lines[0].fields.unit_price.note).toMatch(/differs from the price list/);
    expect(o1.issues.find((i) => i.id === iss.id)).toMatchObject({ status: "resolved", severity: "warning" });
    expect(o1.decisions[0].outcome).toBe("rejected_recommendation");
    const s2 = approveAndSend(s1, id, RITA, LATER);
    expect(order(s2, id).erp.attempts[0].request.lines[0].unitPrice).toBe("18.75");
    expect(order(s2, id).state).toBe("accepted");
  });
});

describe("lead time (R8)", () => {
  const s0 = seedInbox(NOW);
  const id = byPo(s0, "SG-55120").id;
  const iss = primaryIssue(order(s0, id))!;

  it("proposes the earliest date the lead time allows and tells the buyer on the acknowledgement", () => {
    expect(iss).toMatchObject({ field: "delivery_date", original: "2026-10-23", proposed: "2026-10-26" });
    expect(iss.evidence.map((e) => e.text)).toContain("Lead time 10 days for NB-3001");
    const s1 = approveAndSend(decide(s0, id, iss.id, { outcome: "accepted_recommendation" }, RITA, LATER), id, RITA, LATER);
    const o = order(s1, id);
    expect(o.state).toBe("accepted");
    expect(o.erp.attempts[0].request.deliveryDate).toBe("2026-10-26");
    expect(acknowledgement(o)).toBe("Acknowledgement to Summit Grocers (simulated): delivery date confirmed as 2026-10-26 (PO shows 2026-10-23).");
  });

  it("a date that allows the lead time raises nothing", () => {
    expect(byPo(s0, "LF-20419").issues.some((i) => i.rule.id === "R8")).toBe(false);
  });
});

describe("revised and duplicate PO (R9)", () => {
  const s0 = seedInbox(NOW);
  const v1 = byPo(s0, "HV-88220") === undefined ? null : s0.orders.find((o) => o.po.poNumber === "HV-88220")!;
  const v2 = byPo(s0, "HV-88220");

  it("holds the revision with a line diff; revision 1 stays in the ERP", () => {
    expect(v1!.id).not.toBe(v2.id);
    expect(v1!.state).toBe("accepted");
    expect(v1!.history.at(-1)?.type).toBe("revision_received");
    expect(primaryIssue(v2)).toMatchObject({ original: "48", proposed: "60", lineIndex: 0 });
    expect(primaryIssue(v2)!.whyItMatters).toContain(`Your ERP holds revision 1 as ${v1!.erp.erpOrderId}`);
  });

  it("applying the revision updates the existing ERP order and creates no second order", () => {
    const iss = primaryIssue(v2)!;
    const s1 = approveAndSend(decide(s0, v2.id, iss.id, { outcome: "accepted_recommendation" }, RITA, LATER), v2.id, RITA, LATER);
    const o = order(s1, v2.id);
    expect(o.erp.attempts[0].response).toMatchObject({ code: "UPDATED", erpOrderId: v1!.erp.erpOrderId });
    expect(o.erp.erpOrderId).toBe(v1!.erp.erpOrderId);
    expect(acknowledgement(o)).toContain("revision 2 of HV-88220 accepted");
    const ids = s1.orders.filter((x) => x.erp.status === "accepted" && x.erp.attempts.at(-1)?.response.code === "CREATED").map((x) => x.erp.erpOrderId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("an identical PO sent again makes no order", () => {
    const p = po("LAKESHORE", "LF-90004", "LF-DC1", "2026-10-17", "2026-10-31", [ln(1, "NB-4002", "Still Spring Water 1.5 L x 12", "56", "CASE", "7.90")]);
    const s = inbox(p, p);
    expect(s.orders).toHaveLength(1);
    expect(s.orders[0].history.at(-1)).toMatchObject({ type: "duplicate" });
  });
});

describe("idempotent ERP submission", () => {
  it("never creates a second ERP order for the same request", () => {
    const s0 = seedInbox(NOW);
    const ids = s0.orders.filter((o) => o.erp.erpOrderId).map((o) => o.erp.erpOrderId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("rules list", () => {
  it("every rule an issue cites is listed in Rules with the same text", () => {
    const all = [seedInbox(NOW), inbox(po("PRAIRIE", "PF-90005", "none", "2026-10-17", "2026-10-30", [ln(1, null, "Fizz Zero 24 Pack", "4", "CASE", "1.00")]))]
      .flatMap((s) => s.orders.flatMap((o) => o.issues)).filter((i) => i.type !== "downstream_rejection");
    expect(all.length).toBeGreaterThan(3);
    for (const i of all) expect(ORDER_RULES.find((r) => r.id === i.rule.id)?.text).toBe(i.rule.text);
  });
});
