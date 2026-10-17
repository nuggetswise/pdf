// D68: the intake test pack. Each fictional email or file goes through normal intake and the same server actions
// the screens use; the hand-written expected results in fixtures/test-pack/expected-results.json say what must
// be true. The runner is generic: it reads steps and expectations and never branches on a case id or file name.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as pdfjsNode from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it, vi } from "vitest";
import { reconcileFindings, retailerFindings } from "./domain/command-center";
import { normalise } from "./domain/normalise";
import { type RunState, emptyRunState } from "./domain/run-state";
import { type Intake, intakeEdi, intakeEml } from "./intake/intake";
import type { PdfJs } from "./intake/pdf";
import { loadExtractionConfig } from "./server/config";
import { extractPages } from "./server/extract/run";
import { applyAction } from "./server/run-action";

const PACK = join(__dirname, "..", "..", "fixtures", "test-pack");
const pdfjs = pdfjsNode as unknown as PdfJs;
const spec = JSON.parse(readFileSync(join(PACK, "expected-results.json"), "utf8"));
const file = (name: string) => new Uint8Array(readFileSync(join(PACK, name)));

type Expect = Record<string, unknown>;
type Step = { forward?: string; upload_edi?: string; ai_output?: string; action?: Record<string, unknown>;
  retailer_view?: string; expect?: Expect };

/** What the browser does: receive, then for each new document extract (or record the given AI output) and record. */
async function intake(s: RunState, got: Intake, aiOutput?: string): Promise<{ s: RunState; ids: number[] }> {
  const r = applyAction(s, { type: "receive", envelope: got.envelope, attachments: got.attachments, ...(got.email ? { email: got.email } : {}) });
  if (!r.ok) throw new Error(r.error);
  let next = r.state;
  const ids = r.documentIds ?? [];
  for (const docId of ids) {
    const doc = next.documents.find((d) => d.id === docId)!;
    if (doc.status !== "received") continue;
    const started = applyAction(next, { type: "startExtraction", docId });
    if (!started.ok) throw new Error(started.error);
    next = started.state;
    if (aiOutput) {
      const raw = JSON.parse(readFileSync(join(PACK, aiOutput), "utf8"));
      const payload = normalise(raw, doc.pageText, { name: "SIMULATED AI OUTPUT (hand-written test input)", isAi: true });
      const rec = applyAction(next, { type: "recordExtraction", docId, payload });
      if (!rec.ok) throw new Error(rec.error);
      next = rec.state;
      continue;
    }
    const out = await extractPages(doc.pageText, { rehearsal: true, config: loadExtractionConfig({}), kind: doc.kind ?? "pdf" });
    const rec = applyAction(next, out.ok
      ? { type: "recordExtraction", docId, payload: out.payload, ...(out.classification ? { classification: out.classification } : {}) }
      : { type: "failExtraction", docId, kind: out.status, detail: out.detail });
    if (!rec.ok) throw new Error(rec.error);
    next = rec.state;
  }
  return { s: next, ids };
}

/** "$1" is the first document created in this case, "$finding:<type>" and "$message:<kind>" the current ids. */
function resolve(v: unknown, s: RunState, created: number[]): unknown {
  if (typeof v === "string" && /^\$\d+$/.test(v)) return created[Number.parseInt(v.slice(1), 10) - 1];
  if (typeof v === "string" && v.startsWith("$finding:")) return s.commandCenter?.findings.find((f) => f.type === v.slice(9))?.id;
  if (typeof v === "string" && v.startsWith("$message:")) {
    return s.portal?.outbound.find((m) => m.kind === v.slice(9) && m.channel === "retailer_edi_outbox")?.id;
  }
  if (v && typeof v === "object" && !Array.isArray(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x, s, created)]));
  return v;
}

function check(s: RunState, e: Expect, stepIds: number[], created: number[]) {
  if ("documents_created" in e) expect(stepIds).toHaveLength(e.documents_created as number);
  if ("orders" in e) expect(s.orders).toHaveLength(e.orders as number);
  if ("erp_orders" in e) expect(s.erpOrders).toHaveLength(e.erp_orders as number);
  if ("default_policy" in e) expect(s.policyHistory.filter((p) => !p.customerId).at(-1)!.mode).toBe(e.default_policy);
  ((e.docs as Expect[] | undefined) ?? []).forEach((want, i) => {
    const id = (want.doc_id as number | undefined) ? created[(want.doc_id as number) - 1] : stepIds[i];
    const d = s.documents.find((x) => x.id === id)!;
    const o = s.orders.find((x) => x.documentId === id);
    const open = o?.validation.issues.filter((x) => x.status === "open") ?? [];
    if (want.status) expect(d.status).toBe(want.status);
    if (want.kind) expect(d.kind ?? "pdf").toBe(want.kind);
    if (want.review_state) expect(o?.reviewState).toBe(want.review_state);
    if (want.delivery_state) expect(o?.deliveryState).toBe(want.delivery_state);
    if (want.open_issues) expect(open.map((x) => x.code).sort()).toStrictEqual([...(want.open_issues as string[])].sort());
    if (want.open_issues_include) expect(open.map((x) => x.code)).toEqual(expect.arrayContaining(want.open_issues_include as string[]));
    if (want.issue_keys_include) expect(open.map((x) => x.key)).toEqual(expect.arrayContaining(want.issue_keys_include as string[]));
    if (want.issue_lines) {
      for (const [code, line] of Object.entries(want.issue_lines as Record<string, number>)) {
        expect(open.find((x) => x.code === code)?.line_index).toBe(line);
      }
    }
    if (want.candidate_dates) expect([...(open[0].candidate_dates ?? [])].sort()).toStrictEqual(want.candidate_dates);
    if (want.resolved_date) {
      const [field, date] = want.resolved_date as [string, string];
      expect(o?.validation.order.resolved_dates?.[field]).toBe(date);
    }
    if (want.lines !== undefined) expect(o?.validation.order.lines).toHaveLength(want.lines as number);
    if (want.classification_corrected) expect(d.classification?.correctedBy).toBeTruthy();
    if (want.extractor_is_ai !== undefined) {
      expect(s.versions.find((v) => v.documentId === id)!.payload.extractor.is_ai).toBe(want.extractor_is_ai);
    }
  });
  if (e.attachments) {
    const env = s.envelopes.at(-1)!;
    expect((env.attachments ?? []).map((a) => ({ filename: a.filename, handling: a.handling }))).toStrictEqual(e.attachments);
  }
  for (const want of (e.findings as Expect[] | undefined) ?? []) {
    const f = [...(s.commandCenter?.findings ?? [])].reverse().find((x) => x.type === want.type);
    expect(f, `finding ${want.type}`).toBeTruthy();
    if (want.verification) expect(f!.verification.status).toBe(want.verification);
    if (want.action) expect(f!.actionStatus).toBe(want.action);
    if ("owner" in want) expect(f!.owner?.actor ?? null).toBe(want.owner);
    if (want.visibility) expect(f!.visibility).toBe(want.visibility);
    if ("condition_active" in want) expect(f!.conditionActive).toBe(want.condition_active);
    if (want.deadline_source_includes) expect(f!.deadline?.source).toContain(want.deadline_source_includes);
    if (want.lines !== undefined) expect(f!.lines).toHaveLength(want.lines as number);
    if (want.history_includes) expect(f!.history.map((h) => h.kind)).toContain(want.history_includes);
    // Verified only with outcome evidence; pending never claims an outcome it does not hold.
    if (f!.verification.status === "verified") expect(f!.verification.evidence.length).toBeGreaterThan(0);
  }
  // Detection is idempotent: bringing the findings up to date again changes nothing.
  expect(reconcileFindings(s)).toBe(s);
  // Findings are never duplicated: one open finding per condition.
  const open = (s.commandCenter?.findings ?? []).filter((f) => f.verification.status === "pending").map((f) => f.key);
  expect(new Set(open).size).toBe(open.length);
}

describe("intake test pack (fixtures/test-pack, fictional)", () => {
  for (const c of spec.cases as { id: string; title: string; steps: Step[] }[]) {
    it(`${c.id} ${c.title}`, async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(spec.clock));
      try {
        let s = emptyRunState();
        const created: number[] = [];
        for (const step of c.steps) {
          let ids: number[] = [];
          if (step.forward || step.upload_edi) {
            const got = step.forward ? await intakeEml(file(step.forward), "eml_import", { pdfjs })
              : await intakeEdi(file(step.upload_edi!), step.upload_edi!);
            ({ s, ids } = await intake(s, got, step.ai_output));
            created.push(...ids);
          }
          if (step.action) {
            const r = applyAction(s, resolve(step.action, s, created));
            if (step.expect && "refused" in step.expect) {
              expect(r).toMatchObject({ ok: false, status: step.expect.refused });
              continue;
            }
            if (!r.ok) throw new Error(`${String(step.action.type)}: ${r.status} ${r.error}`);
            s = r.state;
          }
          if (step.retailer_view) {
            expect(retailerFindings(s, step.retailer_view).map((f) => f.type)).toStrictEqual(step.expect?.visible_findings);
            continue;
          }
          if (step.expect) check(s, step.expect, ids, created);
        }
      } finally {
        vi.useRealTimers();
      }
    });
  }
});
