"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, DocDetail, ErpOrder, Health, Order, Role, Rule } from "./api";
import { OrderView } from "./OrderView";
import { MemoryView, ErpView } from "./Panels";

/**
 * Click-through guided demo. Every step calls the real local API and waits for the real state change.
 * Nothing here fakes a result: if the backend does not reach the expected state, the step says so.
 */

type Ctx = {
  docs: Record<string, number>;
  call: <T>(path: string, init?: RequestInit & { role?: Role; json?: unknown }) => Promise<T>;
  detail: (name: string) => Promise<DocDetail>;
};
type View = "order" | "memory" | "erp" | "summary";
type Step = {
  title: string; video?: string; say: string; real: string; simulated?: string; actor?: string;
  view: View; order?: string; action?: string;
  run?: (c: Ctx) => Promise<void>;
  until?: (c: Ctx) => Promise<string | true>; // true when done; otherwise a waiting message
};

const REASON = {
  moq: "Customer confirmed a one-off trial quantity (fictional)",
  price: "Promotional price agreed by the account manager (fictional)",
};

async function forward(c: Ctx, name: string) {
  const r = await c.call<{ document_ids: number[] }>(`/api/demo/forward/${name}`, { method: "POST" });
  c.docs[name] = r.document_ids[0];
}

function processed(d: DocDetail): string | true {
  const s = d.document.status;
  if (["extraction_failed", "extraction_unavailable", "unsupported"].includes(s)) throw new ExtractionProblem(d);
  return d.order && !["validating", "matching"].includes(s) ? true : "The agent is reading the PDF and checking rules…";
}

class ExtractionProblem extends Error {
  constructor(public d: DocDetail) { super(d.document.status_detail ?? d.document.status); }
}

async function decide(c: Ctx, name: string, code: string, action: string, reason: string | null, params = {}) {
  const d = await c.detail(name);
  const issue = d.order?.validation.issues.find((i) => i.code === code && i.status === "open");
  if (!issue) throw new Error(`Expected an open ${code} issue on ${name}, but none was found.`);
  await c.call(`/api/documents/${d.document.id}/decisions`, { method: "POST", role: "reviewer", json: { issue_key: issue.key, action, reason, params } });
}

const delivered = (name: string) => async (c: Ctx) => {
  const o = (await c.detail(name)).order;
  if (o?.delivery_state === "erp_created") return true;
  if (o && ["failed", "unknown"].includes(o.delivery_state)) throw new Error(`ERP delivery is ${o.delivery_state}.`);
  return "Sending to the ERP simulator…";
};

export const STEPS: Step[] = [
  {
    title: "Start from a clean, known state", view: "summary", actor: "Alex (demo administrator)",
    say: "This demo processes fictional purchase orders end to end. Each Next click performs a real action in the running prototype and waits for the real result.",
    real: "Database cleared, Review-all mode restored, ERP simulator emptied.",
    simulated: "Email arrives from bundled local .eml files. The ERP is a local simulator.",
    action: "Reset demo",
    run: async (c) => { await c.call("/api/demo/reset", { method: "POST", role: "administrator" }); },
  },
  {
    title: "Administrator turns on Exception-only mode", view: "summary", actor: "Alex (demo administrator)",
    say: "Clean orders will go straight to the ERP. Anything unusual stops for a person. Only an administrator can switch this on, and the switch is recorded.",
    real: "Automation policy changed to Exception-only and versioned.", action: "Enable Exception-only",
    run: async (c) => { await c.call("/api/policy", { method: "PUT", role: "administrator", json: { mode: "exception_only" } }); },
  },
  {
    title: "A customer forwards a PDF purchase order", video: "0:19–0:31", view: "order", order: "VIDEO-DEMO-001",
    say: "The email lands in the agent's inbox. No one clicks Extract: the agent reads the PDF, pulls out every field with the line of text it came from, and matches customer and products.",
    real: "Email and PDF stored with a content hash; fields extracted and checked against the PDF text.",
    simulated: "Forwarding is a local import of a fictional .eml.", action: "Forward VIDEO-DEMO-001",
    run: (c) => forward(c, "VIDEO-DEMO-001"), until: async (c) => processed(await c.detail("VIDEO-DEMO-001")),
  },
  {
    title: "Business rules check every line", video: "0:34–0:38", view: "order", order: "VIDEO-DEMO-001",
    say: "Exact rules, not AI guesses: minimum order quantity, agreed price and retired product codes are compared against versioned reference data. Three lines are held. Click a card to see its evidence highlighted in the PDF text.",
    real: "Deterministic validation against reference data REF-2026-10-v1.",
    until: async (c) => {
      const n = (await c.detail("VIDEO-DEMO-001")).order?.validation.issues.length;
      if (n !== 3) throw new Error(`Expected 3 issues, found ${n}.`);
      return true;
    },
  },
  {
    title: "MOQ: 5 cases ordered, minimum is 10", video: "0:36–0:44", view: "order", order: "VIDEO-DEMO-001", actor: "Rita (demo reviewer)",
    say: "The agent never raises a quantity on its own. The reviewer records an authorised one-off exception with a reason. The quantity stays 5.",
    real: "Decision recorded with actor, time and reason; a new order version is created.", action: "Allow once",
    run: (c) => decide(c, "VIDEO-DEMO-001", "moq_violation", "one_off_exception", REASON.moq),
  },
  {
    title: "Price: printed 26.00, agreed 24.00", video: "0:45–0:53", view: "order", order: "VIDEO-DEMO-001", actor: "Rita (demo reviewer)",
    say: "Both prices are kept. The reviewer accepts the printed price for this order only. This is not saved as a rule, so it cannot quietly apply to future orders.",
    real: "Printed and reference prices preserved; no reusable price exception created.", action: "Accept printed price",
    run: (c) => decide(c, "VIDEO-DEMO-001", "price_mismatch", "accept_printed_price", REASON.price),
  },
  {
    title: "Outdated GTIN: approve the replacement", video: "0:54–1:04", view: "order", order: "VIDEO-DEMO-001", actor: "Rita (demo reviewer)",
    say: "OLD-DEMO-003 is retired; the supplier notice proposes NEW-DEMO-003. The reviewer applies it and offers it to memory. That was the last exception, so the order is approved and sent to the ERP automatically. There is no Send button.",
    real: "Approval bound to this exact version; delivery queued automatically with an idempotency key; the ERP simulator returns its own order ID.",
    simulated: "ERP is a local, persistent simulator.", action: "Apply replacement GTIN",
    run: (c) => decide(c, "VIDEO-DEMO-001", "outdated_identifier", "apply_mapping", null, { save_for_future: true }),
    until: delivered("VIDEO-DEMO-001"),
  },
  {
    title: "Agent memory: the administrator activates what was learned", video: "1:05–1:10", view: "memory", actor: "Alex (demo administrator)",
    say: "The correction became a candidate rule, scoped to this customer and this code, with its source order and approver. It does nothing until an administrator activates it. This is approved memory with provenance, not model retraining.",
    real: "Rule moves from candidate to active; the activation is audited.", action: "Activate memory rule",
    run: async (c) => {
      const rule = (await c.call<Rule[]>("/api/memory-rules")).find((r) => r.state === "candidate");
      if (!rule) throw new Error("No candidate rule was saved.");
      await c.call(`/api/memory-rules/${rule.id}/state`, { method: "POST", role: "administrator", json: { state: "active" } });
    },
  },
  {
    title: "Next order: fixed by memory, straight to ERP", view: "order", order: "VIDEO-DEMO-002",
    say: "The same customer sends a new order with the same retired code. The active rule resolves it and shows which rule and who approved it. Nothing else is wrong, so under Exception-only it is approved by policy and delivered with no human touch.",
    real: "Memory rule applied with provenance; system approval records the policy version; ERP order created.",
    action: "Forward VIDEO-DEMO-002",
    run: (c) => forward(c, "VIDEO-DEMO-002"),
    until: async (c) => { const p = processed(await c.detail("VIDEO-DEMO-002")); return p === true ? delivered("VIDEO-DEMO-002")(c) : p; },
  },
  {
    title: "Different customer: memory does not apply", view: "order", order: "VIDEO-DEMO-003",
    say: "Another customer uses the same retired code. The rule was approved for Northfield only, so this order is held for a person.",
    real: "Scope check: DEMO-CUST-01 rule not applied to DEMO-CUST-02.", action: "Forward VIDEO-DEMO-003",
    run: (c) => forward(c, "VIDEO-DEMO-003"),
    until: async (c) => {
      const d = await c.detail("VIDEO-DEMO-003"); const p = processed(d);
      if (p !== true) return p;
      if (d.order?.review_state !== "needs_review") throw new Error("Expected the order to be held.");
      return true;
    },
  },
  {
    title: "Administrator revokes the rule; the next order is held", view: "order", order: "VIDEO-DEMO-004", actor: "Alex (demo administrator)",
    say: "Memory can be switched off. After revocation, a new Northfield order with the retired code is held again. Orders already in the ERP are not touched.",
    real: "Rule revoked with a reason; later order validated without it.", action: "Revoke rule, forward VIDEO-DEMO-004",
    run: async (c) => {
      const rule = (await c.call<Rule[]>("/api/memory-rules")).find((r) => r.state === "active");
      if (!rule) throw new Error("No active rule to revoke.");
      await c.call(`/api/memory-rules/${rule.id}/state`, { method: "POST", role: "administrator", json: { state: "revoked", reason: "Supplier withdrew the notice (fictional)" } });
      await forward(c, "VIDEO-DEMO-004");
    },
    until: async (c) => {
      const d = await c.detail("VIDEO-DEMO-004"); const p = processed(d);
      if (p !== true) return p;
      if (d.order?.review_state !== "needs_review") throw new Error("Expected the order to be held.");
      return true;
    },
  },
  {
    title: "Review-all mode: every order waits for a person", view: "order", order: "VIDEO-DEMO-005", actor: "Alex (demo administrator)",
    say: "Switched back to the default. Even a perfectly clean order now waits for a human approval.",
    real: "Policy changed to Review-all; clean order held as Waiting for approval.", action: "Switch to Review-all, forward VIDEO-DEMO-005",
    run: async (c) => {
      await c.call("/api/policy", { method: "PUT", role: "administrator", json: { mode: "review_all" } });
      await forward(c, "VIDEO-DEMO-005");
    },
    until: async (c) => {
      const d = await c.detail("VIDEO-DEMO-005"); const p = processed(d);
      if (p !== true) return p;
      if (d.order?.review_state !== "ready") throw new Error("Expected the clean order to wait for approval.");
      return true;
    },
  },
  {
    title: "Approve once; the ERP times out", view: "order", order: "VIDEO-DEMO-005", actor: "Rita (demo reviewer)",
    say: "One approval click and delivery starts by itself. We make the simulator create the order and then time out, so the outcome is unknown. The agent does not blindly resend.",
    real: "Human approval; ERP created the order but the reply was lost; state is Outcome unknown.",
    simulated: "The timeout is a simulator toggle.", action: "Approve order",
    run: async (c) => {
      await c.call("/api/demo/erp-failure-mode", { method: "PUT", role: "administrator", json: { value: "timeout_next" } });
      await c.call(`/api/documents/${c.docs["VIDEO-DEMO-005"]}/approve`, { method: "POST", role: "reviewer" });
    },
    until: async (c) => ((await c.detail("VIDEO-DEMO-005")).order?.delivery_state === "unknown" ? true : "Waiting for the ERP…"),
  },
  {
    title: "Safe retry: reconcile first, never duplicate", view: "erp", order: "VIDEO-DEMO-005", actor: "Rita (demo reviewer)",
    say: "Retry asks the ERP whether it already has this approved version, using the same idempotency key. It does, so the existing order is linked rather than created twice. Forwarding the identical email again is recognised as a duplicate.",
    real: "Reconciliation found the existing ERP order; duplicate file not reprocessed; ERP count unchanged.",
    action: "Retry delivery, forward duplicate",
    run: async (c) => {
      await c.call(`/api/documents/${c.docs["VIDEO-DEMO-005"]}/retry-delivery`, { method: "POST", role: "reviewer" });
      const r = await c.call<{ document_ids: number[] }>("/api/demo/forward/VIDEO-DEMO-005", { method: "POST" });
      c.docs["VIDEO-DEMO-005 (duplicate)"] = r.document_ids[0];
    },
    until: async (c) => {
      const o = (await c.detail("VIDEO-DEMO-005")).order;
      const erp = await c.call<ErpOrder[]>("/api/erp/orders");
      const dup = await c.call<DocDetail>(`/api/documents/${c.docs["VIDEO-DEMO-005 (duplicate)"]}`);
      if (o?.delivery_state !== "erp_created") return "Reconciling with the ERP…";
      if (dup.document.status !== "duplicate") throw new Error("Expected the re-forwarded email to be a duplicate.");
      if (erp.filter((e) => e.payload.order.po_number === "VIDEO-DEMO-005").length !== 1) throw new Error("Expected exactly one ERP order for VIDEO-DEMO-005.");
      return true;
    },
  },
  {
    title: "What you saw, and what is simulated", view: "summary",
    say: "Forwarded PDFs were read, checked against exact business rules, held only where needed, approved with recorded reasons, and delivered automatically and exactly once. A correction became governed memory that an administrator controls.",
    real: "Everything on screen is the live state of this prototype: orders, decisions, approvals, memory rules and ERP records.",
    simulated: "Email intake is a local import; the ERP is a local simulator; all data is fictional; sign-in is demo-only. Time saved is not measured here and is not claimed.",
  },
];

export function GuidedDemo({ health, onSummary }: { health: Health | null; onSummary: () => void }) {
  const [i, setI] = useState(0);
  const [done, setDoneState] = useState<Set<number>>(new Set());
  const doneRef = useRef<Set<number>>(new Set());
  const setDone = (f: Set<number> | ((p: Set<number>) => Set<number>)) => {
    doneRef.current = typeof f === "function" ? f(doneRef.current) : f;
    setDoneState(doneRef.current);
  };
  const [busy, setBusy] = useState(false);
  const [waitMsg, setWaitMsg] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<DocDetail | null>(null);
  const [auto, setAuto] = useState(false);
  const [started, setStarted] = useState(false);
  const [view, setView] = useState<DocDetail | null>(null);
  const docs = useRef<Record<string, number>>({});
  const step = STEPS[i];

  const ctx: Ctx = {
    docs: docs.current,
    call: api,
    detail: (name) => {
      const id = docs.current[name];
      if (id === undefined) throw new Error(`${name} has not arrived yet.`);
      return api<DocDetail>(`/api/documents/${id}`);
    },
  };

  // Live view of the step's order, refreshed continuously so state changes are visible as they happen.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const id = step.order ? docs.current[step.order] : undefined;
      if (id === undefined) { setView(null); return; }
      try { const d = await api<DocDetail>(`/api/documents/${id}`); if (alive) setView(d); } catch { /* shown via step error */ }
    };
    tick();
    const t = setInterval(tick, 900);
    return () => { alive = false; clearInterval(t); };
  }, [i, step.order, done]);

  const perform = useCallback(async (idx: number) => {
    const s = STEPS[idx];
    setBusy(true); setError(null); setProblem(null); setWaitMsg(null); setElapsed(0);
    const c: Ctx = { ...ctx, docs: docs.current };
    try {
      if (!doneRef.current.has(idx) && s.run) await s.run(c);
      if (s.until) {
        const t0 = Date.now();
        for (;;) {
          const r = await s.until(c);
          if (r === true) break;
          setWaitMsg(r); setElapsed(Math.round((Date.now() - t0) / 1000));
          if (Date.now() - t0 > 240_000) throw new Error("Timed out after 4 minutes waiting for the real state change.");
          await new Promise((res) => setTimeout(res, 700));
        }
      }
      setDone((p) => new Set(p).add(idx));
      onSummary();
      return true;
    } catch (e) {
      if (e instanceof ExtractionProblem) setProblem(e.d);
      setError((e as Error).message);
      setAuto(false);
      return false;
    } finally {
      setBusy(false); setWaitMsg(null);
    }
  }, [onSummary]); // eslint-disable-line react-hooks/exhaustive-deps

  async function start(rehearsal: boolean) {
    docs.current = {};
    setDone(new Set()); setI(0); setStarted(true);
    const ok = await perform(0);
    if (ok) await api("/api/demo/rehearsal-mode", { method: "PUT", role: "administrator", json: { value: rehearsal ? "on" : "off" } });
    onSummary();
  }

  // First click performs the step and shows its real result; the next click moves on.
  async function next() {
    if (!doneRef.current.has(i)) await perform(i);
    else if (i < STEPS.length - 1) setI(i + 1);
  }

  // Autoplay: perform the current step, pause to read, then move on.
  useEffect(() => {
    if (!auto || busy || !started) return;
    if (done.has(i) && i === STEPS.length - 1) { setAuto(false); return; }
    const t = setTimeout(async () => {
      if (!done.has(i)) await perform(i);
      else setI((x) => Math.min(x + 1, STEPS.length - 1));
    }, done.has(i) ? 7000 : 2500);
    return () => clearTimeout(t);
  }, [auto, busy, started, i, done, perform]);

  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (!started || (e.target as HTMLElement).closest("input,select,textarea")) return;
      if (e.key === "ArrowRight" && !busy) next();
      if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
      if (e.key === " ") { e.preventDefault(); setAuto((a) => !a); }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  async function retryExtraction(rehearsal: boolean) {
    if (!problem) return;
    if (rehearsal) await api("/api/demo/rehearsal-mode", { method: "PUT", role: "administrator", json: { value: "on" } });
    await api(`/api/documents/${problem.document.id}/retry-extraction`, { method: "POST" });
    setProblem(null); setError(null);
    await perform(i);
  }

  const aiAvailable = health?.extraction === "available" && health.extractor_mode !== "test";

  if (!started) {
    return (
      <section className="intro" aria-label="Start the guided demo">
        <div className="eyebrow">Guided demo · about 5 minutes · {STEPS.length} steps</div>
        <h2>From a forwarded PDF to an ERP order, with people only where they are needed</h2>
        <p>Click through at your own pace, or press Play to let it run. Every step performs a real action in this prototype and waits for the real result. Each card says what is real and what is simulated.</p>
        <div className="start-buttons">
          <button className="primary big" disabled={!aiAvailable} onClick={() => start(false)}>
            Start demo with live AI extraction{health?.model ? ` (${health.model})` : ""}
          </button>
          <button className="big" onClick={() => start(true)}>Start in rehearsal mode (TEST ADAPTER, not AI)</button>
        </div>
        {!aiAvailable && <p className="note">Live AI extraction is unavailable here (no Gemini key configured), so only rehearsal mode can run. Rehearsal mode uses a labelled fixture parser and is never presented as AI.</p>}
        {aiAvailable && <p className="note">Gemini can be slow under load (sometimes over a minute). If it is busy, the demo says so and offers a retry or rehearsal mode.</p>}
        <p className="muted small">Starting resets the prototype to a known state. Keyboard: → next, ← back, Space play/pause.</p>
      </section>
    );
  }

  return (
    <div className="demo">
      <aside className="narration" aria-live="polite">
        <div className="progress" aria-label={`Step ${i + 1} of ${STEPS.length}`}>
          {STEPS.map((s, k) => (
            <button key={k} className={`tick ${k === i ? "now" : done.has(k) ? "done" : ""}`} aria-label={`Step ${k + 1}: ${s.title}`}
              onClick={() => (done.has(k) || k <= Math.max(-1, ...Array.from(done)) + 1) && setI(k)} />
          ))}
        </div>
        <div className="stepno">Step {i + 1} of {STEPS.length}{step.video && <span className="video">Video {step.video}</span>}</div>
        <h2>{step.title}</h2>
        {step.actor && <div className="actor">Acting as {step.actor}</div>}
        <p className="say">{step.say}</p>
        <div className="truth">
          <div><b>Real</b><span>{step.real}</span></div>
          {step.simulated && <div className="sim"><b>Simulated</b><span>{step.simulated}</span></div>}
        </div>
        {waitMsg && <div className="waiting pulse">{waitMsg} <span className="muted">{elapsed}s</span></div>}
        {error && (
          <div className="alert bad" role="alert">
            {problem ? <>AI extraction did not finish: {error}</> : <>This step did not reach the expected state: {error}</>}
            {problem && (
              <div className="btns">
                {problem.document.status !== "unsupported" && <button onClick={() => retryExtraction(false)}>Retry extraction</button>}
                <button onClick={() => retryExtraction(true)}>Switch to rehearsal mode and retry</button>
              </div>
            )}
          </div>
        )}
        <div className="controls">
          <button onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0 || busy}>← Back</button>
          <button className="primary big" onClick={next} disabled={busy || (done.has(i) && i === STEPS.length - 1)}>
            {busy ? "Working…" : done.has(i) ? (i === STEPS.length - 1 ? "Finished" : "Next →") : step.action ? `${step.action} →` : "Continue →"}
          </button>
          <button onClick={() => setAuto(!auto)} aria-pressed={auto}>{auto ? "❚❚ Pause" : "▶ Play"}</button>
        </div>
        {i > 0 && done.has(i) === false && Array.from(done).some((k) => k > i) && <p className="muted small">Already performed; Back only revisits the explanation.</p>}
        <button className="link" onClick={() => { setStarted(false); setAuto(false); }}>Restart demo</button>
      </aside>
      <section className="stage" aria-label="Live prototype view">
        {step.view === "order" && (view ? <OrderView d={view} role="viewer" highlight={`focus-${i}`} /> : <div className="placeholder">The order will appear here when it arrives.</div>)}
        {step.view === "memory" && <MemoryView role="viewer" />}
        {step.view === "erp" && <><ErpView />{view && <OrderView d={view} role="viewer" />}</>}
        {step.view === "summary" && <SummaryStage health={health} />}
      </section>
    </div>
  );
}

function SummaryStage({ health }: { health: Health | null }) {
  const [orders, setOrders] = useState<Order[]>([]);
  useEffect(() => {
    const t = setInterval(() => api<Order[]>("/api/orders").then(setOrders).catch(() => {}), 1000);
    api<Order[]>("/api/orders").then(setOrders).catch(() => {});
    return () => clearInterval(t);
  }, []);
  return (
    <div className="summary-stage">
      <div className={`mode-card ${health?.policy.mode}`}>
        <div className="eyebrow">Automation mode</div>
        <h3>{health?.policy.mode === "exception_only" ? "Exception-only" : "Review-all"}</h3>
        <p>{health?.policy.mode === "exception_only" ? "Clean orders are approved by policy and delivered automatically. Exceptions wait for a reviewer." : "Every order waits for a human approval, even when it is clean."}</p>
        <p className="muted small">Set by {health?.policy.set_by.split(":")[1] ?? health?.policy.set_by} · policy version {health?.policy.id}</p>
      </div>
      {orders.length > 0 && (
        <table className="lines">
          <thead><tr><th>PO</th><th>Customer</th><th>Approval</th><th>ERP</th></tr></thead>
          <tbody>{orders.map((o) => (
            <tr key={o.document_id}><td>{o.po_number}</td><td>{o.customer_id}</td>
              <td>{o.approvals.at(-1) ? (o.approvals.at(-1)!.kind === "system" ? "By policy" : `By ${o.approvals.at(-1)!.actor.split(":")[1]}`) : o.review_state.replace("_", " ")}</td>
              <td>{o.erp_order_id ?? o.delivery_state.replace("_", " ")}</td></tr>))}</tbody>
        </table>
      )}
    </div>
  );
}
