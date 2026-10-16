"use client";
// The run lives in this browser tab (D31). This provider holds it, saves it to sessionStorage after every change,
// sends each action to the server one at a time, and runs the agent's background work: reading forwarded PDFs
// and asking the server to extract them. The original PDFs are kept in this browser (IndexedDB) for the page view.
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { DEMO_EMAILS, demoEmailPath, intakeEml, intakeUpload, type Intake } from "../../lib/intake/intake";
import { IntakeRejected } from "../../lib/intake/pdf";
import { browserPdfjs } from "../../lib/intake/pdfjs-browser";
import { emptyRunState, RunState, runStateSizeBytes, SESSION_STORAGE_WARN_BYTES } from "../../lib/domain/run-state";
import { currentPolicy } from "../../lib/domain/selectors";
import type { Action } from "../../lib/server/run-action";
import type { Health } from "../api";
import { runAction } from "../actions/run";
import { clearPdfs, loadPdf, savePdf } from "./pdf-store";

const STORAGE_KEY = "order-agent-run-v1";
const INTERRUPTED = "Extraction was interrupted when the page reloaded. Use Retry extraction.";

export type Extraction = { extraction: string; extractor_mode: string; model: string | null };

type Agent = {
  state: RunState;
  /** The newest run, for code that waits on a change (the guided demo). */
  latest: () => RunState;
  ready: boolean;
  extraction: Extraction | null;
  serverError: string | null;
  storageWarning: string | null;
  /** Runs one action on the server; throws an Error carrying the server's message if it is refused. */
  run: (action: Action) => Promise<number[]>;
  forwardDemo: (name: string) => Promise<number[]>;
  importEml: (raw: Uint8Array) => Promise<number[]>;
  uploadPdf: (pdf: Uint8Array, filename: string) => Promise<number[]>;
  retryExtraction: (docId: number) => Promise<void>;
  resetDemo: () => Promise<void>;
  /** The original PDF, from memory or from this browser's storage; null when it is not kept (storage blocked). */
  pdfBytes: (docId: number) => Promise<Uint8Array | null>;
};

const Ctx = createContext<Agent | null>(null);

export function useAgent(): Agent {
  const a = useContext(Ctx);
  if (!a) throw new Error("useAgent must be used inside RunProvider");
  return a;
}

function load(): RunState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = RunState.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    }
  } catch { /* unreadable or blocked storage: start a fresh run */ }
  return emptyRunState();
}

export function RunProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<RunState>(() => emptyRunState());
  const [ready, setReady] = useState(false);
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const stateRef = useRef(state);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const pdfs = useRef(new Map<number, Uint8Array>());

  const commit = useCallback((next: RunState) => {
    stateRef.current = next;
    setState(next);
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setStorageWarning(runStateSizeBytes(next) > SESSION_STORAGE_WARN_BYTES
        ? "This run is close to the browser's storage limit for a tab. Reset the demo soon." : null);
    } catch {
      setStorageWarning("This browser would not save the run, so a reload will lose it.");
    }
  }, []);

  /** One action at a time, each applied to the newest run. */
  const run = useCallback((action: Action): Promise<number[]> => {
    const p = queue.current.then(async () => {
      const res = await runAction(stateRef.current, action);
      if (!res.ok) throw new Error(res.error);
      commit(res.state);
      return res.documentIds ?? [];
    });
    queue.current = p.catch(() => {});
    return p;
  }, [commit]);

  /** The agent's own work on a received document: extraction, then matching and checks on the server. */
  const process = useCallback(async (docId: number) => {
    const doc = stateRef.current.documents.find((d) => d.id === docId);
    if (!doc || doc.status !== "received") return;
    const same = () => stateRef.current.documents.some((d) => d.id === docId && d.sha256 === doc.sha256
      && d.createdAt === doc.createdAt && d.status === "extracting");
    try {
      await run({ type: "startExtraction", docId });
      let outcome: { ok: true; payload: unknown } | { ok: false; status: string; detail: string };
      try {
        const r = await fetch("/api/extract", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pages: doc.pageText, rehearsal: stateRef.current.settings.rehearsalMode }) });
        outcome = r.ok ? await r.json() : { ok: false, status: "extraction_failed",
          detail: `Extraction failed (${r.status === 413 ? "the page text is too large to send" : `the server answered HTTP ${r.status}`}). Use Retry extraction.` };
      } catch {
        outcome = { ok: false, status: "extraction_failed", detail: "Extraction failed (the server could not be reached). Use Retry extraction." };
      }
      // A reset while extraction ran means this document is gone; its result must not land on a new one.
      if (!same()) return;
      if (outcome.ok) await run({ type: "recordExtraction", docId, payload: outcome.payload as never });
      else await run({ type: "failExtraction", docId, kind: outcome.status as "extraction_failed", detail: outcome.detail });
    } catch (e) {
      setServerError((e as Error).message);
    }
  }, [run]);

  const receive = useCallback(async (intake: Intake) => {
    const ids = await run({ type: "receive", envelope: intake.envelope, attachments: intake.attachments });
    ids.forEach((id, i) => {
      pdfs.current.set(id, intake.pdfBytes[i]);
      const sha = stateRef.current.documents.find((d) => d.id === id)?.sha256;
      if (sha) void savePdf(sha, intake.pdfBytes[i]);
    });
    for (const id of ids) void process(id);
    return ids;
  }, [run, process]);

  const readEml = useCallback(async (raw: Uint8Array, mode: "eml_import" | "local_forward_demo") => {
    try {
      return await intakeEml(raw, mode, { pdfjs: await browserPdfjs() });
    } catch (e) {
      if (e instanceof IntakeRejected) throw new Error(e.message);
      throw e;
    }
  }, []);

  const forwardDemo = useCallback(async (name: string) => {
    const path = demoEmailPath(name);
    if (!path) throw new Error("Unknown demo email");
    const r = await fetch(path, { cache: "no-store" });
    if (!r.ok) throw new Error(`Demo email could not be loaded (HTTP ${r.status})`);
    return receive(await readEml(new Uint8Array(await r.arrayBuffer()), "local_forward_demo"));
  }, [receive, readEml]);

  const importEml = useCallback(async (raw: Uint8Array) => receive(await readEml(raw, "eml_import")), [receive, readEml]);

  /** A PDF purchase order the user uploads directly: no email around it, so sender and subject are empty. */
  const uploadPdf = useCallback(async (pdf: Uint8Array, filename: string) => {
    try {
      return await receive(await intakeUpload(pdf, filename, { sender: "" }, { pdfjs: await browserPdfjs() }));
    } catch (e) {
      if (e instanceof IntakeRejected) throw new Error(e.message);
      throw e;
    }
  }, [receive]);

  const retryExtraction = useCallback(async (docId: number) => {
    await run({ type: "retryExtraction", docId });
    await process(docId);
  }, [run, process]);

  const resetDemo = useCallback(async () => {
    await run({ type: "resetDemo", role: "administrator" });
    pdfs.current.clear();
    void clearPdfs();
  }, [run]);

  // Restore the run saved in this tab. Extraction cannot resume after a reload, so a document caught
  // mid-extraction is marked failed with a retry, never left looking busy.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const saved = load();
    stateRef.current = saved;
    setState(saved);
    setReady(true);
    for (const d of saved.documents) {
      if (d.status === "received" || d.status === "extracting") {
        void run({ type: "failExtraction", docId: d.id, kind: "extraction_failed", detail: INTERRUPTED }).catch(() => {});
      }
    }
  }, [run]);

  useEffect(() => {
    fetch("/api/extract", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((h: Extraction) => { setExtraction(h); setServerError(null); })
      .catch((e: Error) => setServerError(`Server not reachable: ${e.message}`));
  }, []);

  const value = useMemo<Agent>(() => ({
    state, ready, extraction, serverError, storageWarning, run, forwardDemo, importEml, uploadPdf, retryExtraction, resetDemo,
    latest: () => stateRef.current,
    pdfBytes: async (id) => {
      const mem = pdfs.current.get(id);
      if (mem) return mem;
      const sha = stateRef.current.documents.find((d) => d.id === id)?.sha256;
      const kept = sha ? await loadPdf(sha) : null;
      if (kept) pdfs.current.set(id, kept);
      return kept;
    },
  }), [state, ready, extraction, serverError, storageWarning, run, forwardDemo, importEml, uploadPdf, retryExtraction, resetDemo]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The topbar's health: extraction from the server, everything else from this tab's run. */
export function useHealth(): Health | null {
  const { state, extraction, ready } = useAgent();
  return useMemo(() => (!extraction || !ready ? null : {
    status: "ok", ...extraction, erp: "simulator", rehearsal_mode: state.settings.rehearsalMode,
    erp_failure_mode: state.settings.erpFailureMode, policy: currentPolicy(state),
  }), [state, extraction, ready]);
}

export { DEMO_EMAILS };
