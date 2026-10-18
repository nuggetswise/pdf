"use client";
// Order Operations state (D71), held in this browser tab like the rest of the run. The sample inbox is read and
// processed the first time the tab opens; every later change is a pure engine transition saved after it runs.
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  approveAndSend, decide, type DecisionInput, isOpsState, OpsRefused, seedInbox, undoDecision,
} from "../../lib/domain/ops/engine";
import type { Actor, OpsState } from "../../lib/domain/ops/types";

const KEY = "order-ops-v2";

type Ops = {
  state: OpsState | null;
  decide: (orderId: string, issueId: string, input: DecisionInput, actor: Actor) => void;
  undo: (orderId: string, decisionId: number, actor: Actor) => void;
  approve: (orderId: string, actor: Actor) => void;
  error: string | null;
  clearError: () => void;
};

const Ctx = createContext<Ops | null>(null);
export function useOps(): Ops {
  const v = useContext(Ctx);
  if (!v) throw new Error("useOps must be used inside OpsProvider");
  return v;
}

export function OpsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OpsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<OpsState | null>(null);

  useEffect(() => {
    let saved: OpsState | null = null;
    try {
      const raw = sessionStorage.getItem(KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (isOpsState(parsed)) saved = parsed;
    } catch { /* blocked or unreadable storage: read the inbox again */ }
    const next = saved ?? seedInbox(new Date().toISOString());
    ref.current = next;
    setState(next);
    try { sessionStorage.setItem(KEY, JSON.stringify(next)); } catch { /* not saved; this tab still works */ }
  }, []);

  const apply = useCallback((f: (s: OpsState, at: string) => OpsState) => {
    if (!ref.current) return;
    try {
      const next = f(ref.current, new Date().toISOString());
      ref.current = next;
      setState(next);
      setError(null);
      try { sessionStorage.setItem(KEY, JSON.stringify(next)); } catch { /* kept in memory */ }
    } catch (e) {
      setError(e instanceof OpsRefused ? e.message : `Action failed: ${(e as Error).message}`);
    }
  }, []);

  const value = useMemo<Ops>(() => ({
    state, error, clearError: () => setError(null),
    decide: (orderId, issueId, input, actor) => apply((s, at) => decide(s, orderId, issueId, input, actor, at)),
    undo: (orderId, decisionId, actor) => apply((s, at) => undoDecision(s, orderId, decisionId, actor, at)),
    approve: (orderId, actor) => apply((s, at) => approveAndSend(s, orderId, actor, at)),
  }), [state, error, apply]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
