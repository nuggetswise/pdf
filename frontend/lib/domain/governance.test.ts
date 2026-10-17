// D63-D65: internal hold, reject with an optional reason, supervision per retailer and route, choosing a location
// from those on file, and dates that are not calendar dates. Fictional demo emails, TEST ADAPTER.
import { describe, expect, it } from "vitest";
import { ADMIN, EMAILS, REVIEWER, VIEWER, forward, tickClock } from "./__fixtures__/demo";
import { emptyRunState } from "./run-state";
import { decide, effectivePolicy, holdOrder, rejectOrder, releaseHold, setPolicy, setRoutePolicy } from "./workflow";

const page = (from: string, to: string) => ({ pageText: EMAILS["VIDEO-DEMO-005"].attachments[0].pageText.map((p) => p.replace(from, to)),
  sha256: `${"e".repeat(60)}${from.length}${to.length}`.slice(0, 64) });
const orderOf = (s: ReturnType<typeof emptyRunState>, id: number) => s.orders.find((o) => o.documentId === id)!;

describe("internal hold (D64)", () => {
  it("stops a clean order before the ERP, withdraws approval, and releases back into the flow", () => {
    const clock = tickClock();
    let { state: s, docId } = forward(emptyRunState(), "VIDEO-DEMO-005", clock);
    expect(orderOf(s, docId).reviewState).toBe("ready");
    s = holdOrder(s, docId, "checking_with_buyer", REVIEWER, clock);
    expect(orderOf(s, docId).reviewState).toBe("on_hold");
    expect(() => holdOrder(s, docId, "checking_with_buyer", REVIEWER, clock)).toThrow(/already/);
    // Switching to automatic does not release a held order.
    s = setPolicy(s, "exception_only", ADMIN, clock, "Pilot evidence reviewed (fictional)");
    expect(orderOf(s, docId).deliveryState).toBe("not_started");
    s = releaseHold(s, docId, REVIEWER, clock);
    expect(s.holds?.[0]).toMatchObject({ reason: "checking_with_buyer", heldBy: "reviewer:rita", releasedBy: "reviewer:rita" });
    expect(orderOf(s, docId).reviewState).not.toBe("on_hold");
  });
  it("needs a reason from the list and a reviewer", () => {
    const clock = tickClock();
    const { state: s, docId } = forward(emptyRunState(), "VIDEO-DEMO-005", clock);
    expect(() => holdOrder(s, docId, "because", REVIEWER, clock)).toThrow("Choose a hold reason");
    expect(() => holdOrder(s, docId, "pricing_review", VIEWER, clock)).toThrow();
  });
});

describe("reject (D64)", () => {
  it("needs no typed explanation, takes an optional reason choice, and is refused after the ERP", () => {
    const clock = tickClock();
    let { state: s, docId } = forward(emptyRunState(), "VIDEO-DEMO-001", clock);
    s = rejectOrder(s, docId, null, REVIEWER, clock);
    expect(orderOf(s, docId).reviewState).toBe("rejected");
    let next = forward(s, "VIDEO-DEMO-004", clock);
    next.state = rejectOrder(next.state, next.docId, "customer_cancelled", REVIEWER, clock);
    expect(next.state.audit.filter((a) => a.event === "rejected").map((a) => a.detail.reason_code)).toStrictEqual([null, "customer_cancelled"]);
    expect(() => rejectOrder(next.state, next.docId, "made_up", REVIEWER, clock)).toThrow("Unknown reject reason");
    let auto = setPolicy(emptyRunState(), "exception_only", ADMIN, clock, "Pilot evidence reviewed (fictional)");
    const sent = forward(auto, "VIDEO-DEMO-005", clock);
    auto = sent.state;
    expect(orderOf(auto, sent.docId).deliveryState).toBe("erp_created");
    expect(() => rejectOrder(auto, sent.docId, null, REVIEWER, clock)).toThrow(/already in the ERP/);
  });
});

describe("supervision per retailer and route (D64)", () => {
  it("defaults to supervised, needs a reason for automatic, and applies only to its own retailer and route", () => {
    const clock = tickClock();
    let s = emptyRunState();
    expect(() => setRoutePolicy(s, "DEMO-CUST-01", "email_attachment", "exception_only", null, ADMIN, clock))
      .toThrow("Enter the reason for automatic processing");
    expect(() => setRoutePolicy(s, "DEMO-CUST-01", "email_attachment", "exception_only", "ok", REVIEWER, clock)).toThrow();
    s = setRoutePolicy(s, "DEMO-CUST-01", "email_attachment", "exception_only", "Two weeks of clean pilot orders (fictional)", ADMIN, clock);
    const a = forward(s, "VIDEO-DEMO-005", clock);
    expect(orderOf(a.state, a.docId).deliveryState).toBe("erp_created");
    expect(effectivePolicy(a.state, a.docId)).toMatchObject({ customerId: "DEMO-CUST-01", channel: "email_attachment",
      reason: "Two weeks of clean pilot orders (fictional)" });
    // Same retailer, another route: still supervised.
    const up = forward(s, "VIDEO-DEMO-005", clock, { envelope: { intakeMode: "demo_envelope_upload", messageId: null, sender: null } });
    expect(orderOf(up.state, up.docId).reviewState).toBe("ready");
    // Blocking issues stop an order in automatic mode too.
    const held = forward(s, "VIDEO-DEMO-001", clock);
    expect(orderOf(held.state, held.docId).reviewState).toBe("needs_review");
  });
});

describe("location and date choices (D63, D65)", () => {
  it("an unknown ship-to offers the locations on file; the choice goes on the order and the printed code is kept", () => {
    const clock = tickClock();
    let { state: s, docId } = forward(emptyRunState(), "VIDEO-DEMO-005", clock, { attachment: page("Ship-to: DEMO-DC-01", "Ship-to: STORE 0412") });
    const issue = orderOf(s, docId).validation.issues.find((i) => i.code === "unknown_ship_to")!;
    expect(issue.candidate_ship_tos).toStrictEqual(["DEMO-DC-01"]);
    expect(issue.actions).toContain("choose_ship_to");
    expect(() => decide(s, docId, { issueKey: issue.key, action: "choose_ship_to", reason: "Store delivers via DC 01 (fictional)",
      params: { ship_to_id: "NOT-ON-FILE" } }, REVIEWER, clock)).toThrow();
    s = decide(s, docId, { issueKey: issue.key, action: "choose_ship_to", reason: "Store delivers via DC 01 (fictional)",
      params: { ship_to_id: "DEMO-DC-01" } }, REVIEWER, clock);
    expect(orderOf(s, docId).validation.order).toMatchObject({ ship_to_id: "DEMO-DC-01", printed_ship_to_id: "STORE 0412" });
  });
  it("a weekday is not a calendar date: it waits for a person and is never guessed", () => {
    const clock = tickClock();
    const { state: s, docId } = forward(emptyRunState(), "VIDEO-DEMO-005", clock,
      { attachment: page("Requested delivery date: 2026-10-24", "Requested delivery date: Thursday") });
    const issue = orderOf(s, docId).validation.issues.find((i) => i.code === "unclear_date")!;
    expect(issue).toMatchObject({ key: "unclear_date:requested_delivery_date", printed_value: "Thursday", blocking: true });
    expect(orderOf(s, docId).validation.order.resolved_dates?.requested_delivery_date).toBeUndefined();
  });
});
