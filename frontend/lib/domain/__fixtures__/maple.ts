// Test helpers (D75): the fictional Maple Retail Group emails (fixtures/maple) fed through intake and the labelled
// TEST ADAPTER. maple-inbox.json holds what intake made of each email; maple-inbox.test.ts checks it is current.
// Used by the Vitest workflow tests only.
import { FIXTURE_EXTRACTOR, fixtureExtractAny } from "../extract/fixture";
import { pyStrip } from "../money";
import { normalise } from "../normalise";
import { type OrderVersion, type RunState, emptyRunState } from "../run-state";
import {
  type Clock, EXTRACTION_MESSAGES, type IncomingDocument, type IncomingEnvelope, type Who, approve, decide, failExtraction,
  receive, recordExtraction, resetDemo, setDemoSetting, startExtraction,
} from "../workflow";
import inbox from "./maple-inbox.json";

export const REVIEWER: Who = { actor: "reviewer:rita", role: "reviewer" };
export const ADMIN: Who = { actor: "administrator:alex", role: "administrator" };
export const VIEWER: Who = { actor: "viewer:demo", role: "viewer" };
export const INTAKE_ACTOR = "intake:order-mailbox";

export type MapleName = keyof typeof inbox.emails;
export const EMAILS = inbox.emails as Record<MapleName, { envelope: IncomingEnvelope; attachments: IncomingDocument[] }>;

/** A clock that moves forward one millisecond per reading, so every run is reproducible. */
export function tickClock(start = Date.parse("2026-10-15T15:00:00.000Z")): Clock {
  let t = start;
  return { now: () => new Date(t++).toISOString() };
}

/** pipeline.process_document with the TEST ADAPTER: extraction then the automatic workflow. */
export function extract(state: RunState, docId: number, clock: Clock): RunState {
  const doc = state.documents.find((d) => d.id === docId)!;
  if (doc.status !== "received" && doc.status !== "extracting") return state;
  let s = startExtraction(state, docId, clock);
  const pages = doc.pageText;
  if (!pages.some((p) => pyStrip(p))) return failExtraction(s, docId, "unsupported", EXTRACTION_MESSAGES.unsupported, clock);
  const payload = normalise(fixtureExtractAny(pages), pages, { name: FIXTURE_EXTRACTOR.name, isAi: FIXTURE_EXTRACTOR.isAi });
  s = recordExtraction(s, docId, payload as unknown as OrderVersion["payload"], clock);
  return s;
}

/** Receive one Maple email, optionally changing its envelope or PDF first. Returns the run and the first new document. */
export function forward(state: RunState, name: MapleName, clock: Clock,
  change: { envelope?: Partial<IncomingEnvelope>; attachment?: Partial<IncomingDocument> } = {},
): { state: RunState; docId: number } {
  const email = EMAILS[name];
  const envelope = { ...email.envelope, ...change.envelope };
  const attachments = email.attachments.map((a) => ({ ...structuredClone(a), ...change.attachment }));
  const received = receive(state, envelope, attachments, INTAKE_ACTOR, clock);
  let s = received.state;
  for (const id of received.documentIds) s = extract(s, id, clock);
  return { state: s, docId: received.documentIds[0] };
}

const ISO = /\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)/g;

/** Replace every timestamp so two runs made at different times can be compared exactly. */
export function maskTimes<T>(value: T): T {
  return JSON.parse(JSON.stringify(value), (_k, v) => (typeof v === "string" ? maskEdi(v.replace(ISO, "<time>")) : v));
}

/** EDIFACT bodies (D45) carry the action's date and time in their own format; mask those too. */
const maskEdi = (v: string) =>
  v.replace(/(UNB\+[^']*?\+)\d{6}:\d{4}/g, "$1<edi-time>").replace(/(DTM\+\d+:)\d{8}/g, "$1<edi-date>")
    .replace(/^((?:Response|Document|Invoice|Despatch advice) date )\d{8}$/, "$1<edi-date>")
    // X12 (D50): ISA and GS date and time, BSN and BIG document dates.
    .replace(/(\*14\*[^*]{15}\*)\d{6}\*\d{4}\*U\*/g, "$1<edi-time>*U*")
    .replace(/(GS\*\w\w\*[^*]*\*[^*]*\*)\d{8}\*\d{4}\*/g, "$1<edi-time>*")
    .replace(/(BSN\*00\*[^*]*\*)\d{8}\*\d{4}\*/g, "$1<edi-time>*")
    .replace(/BIG\*\d{8}\*/g, "BIG*<edi-date>*")
    .replace(/ dated \d{8} /g, " dated <edi-date> ");

/**
 * A run the screens could have produced (test helper): the milk PO approved and delivered (document 1, two lines,
 * confirmed to the retailer), then the cheese PO decided on its price and delivered (document 2, Mozzarella short).
 */
export function mapleRun(): RunState {
  const clock = tickClock();
  let s = resetDemo(emptyRunState(clock.now()), ADMIN, clock);
  s = setDemoSetting(s, "rehearsal_mode", "on", ADMIN, clock);
  ({ state: s } = forward(s, "milk", clock));
  s = approve(s, 1, REVIEWER, clock);
  ({ state: s } = forward(s, "cheese", clock));
  s = decide(s, 2, { issueKey: "price_mismatch:0", action: "accept_printed_price",
    reason: "Retailer confirmed the new Cheddar price by phone (fictional)" }, REVIEWER, clock);
  return s;
}
