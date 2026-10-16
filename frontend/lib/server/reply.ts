// D54: read a supplier's plain-language reply against the PO lines. Gemini when configured; the labelled
// TEST ADAPTER in rehearsal or test mode. Every change is checked word for word against the reply before it is
// returned. Nothing is kept between requests; logs carry counts only, never reply text.
import "server-only";
import {
  REPLY_RESPONSE_SCHEMA, REPLY_SYSTEM_INSTRUCTION, type ReplyPoLine, type SupplierReplyInterpretation,
  checkInterpretation, rehearsalReadReply, replyPrompt,
} from "../domain/reply";
import type { ExtractionConfig } from "./config";
import { GeminiBusy, type GeminiDeps, GeminiError, GeminiExtractor, defaultGeminiDeps } from "./extract/gemini";

export const REHEARSAL_READER = "Rehearsal reply reader (TEST ADAPTER, not AI)";

export type ReplyOutcome = { ok: true; interpretation: SupplierReplyInterpretation } | { ok: false; detail: string };

export async function readReply(text: string, lines: ReplyPoLine[], today: string,
  opts: { rehearsal: boolean; config: ExtractionConfig; deps?: GeminiDeps }): Promise<ReplyOutcome> {
  const deps = opts.deps ?? defaultGeminiDeps();
  if (opts.rehearsal || opts.config.mode === "test") {
    return { ok: true, interpretation: checkInterpretation(rehearsalReadReply(text, lines, today), text, lines,
      { name: REHEARSAL_READER, isAi: false }) };
  }
  const { apiKey, model, fallbackModel } = opts.config;
  if (!apiKey || !model) return { ok: false, detail: "AI reading is not configured on the server." };
  const gemini = new GeminiExtractor(apiKey, model, fallbackModel, deps);
  try {
    const raw = await gemini.generate(REPLY_SYSTEM_INSTRUCTION, REPLY_RESPONSE_SCHEMA, replyPrompt(text, lines, today));
    const interpretation = checkInterpretation(raw, text, lines, { name: gemini.name, isAi: true });
    deps.log(`reply read changes=${interpretation.lines.length} unclear=${interpretation.unclear.length}`);
    return { ok: true, interpretation };
  } catch (exc) {
    const reason = exc instanceof GeminiBusy ? "the AI service is busy" : exc instanceof GeminiError ? exc.message : (exc as Error)?.name;
    deps.log(`reply read failed error=${(exc as Error)?.name}`);
    return { ok: false, detail: `The reply could not be read (${reason}). Try again.` };
  }
}
