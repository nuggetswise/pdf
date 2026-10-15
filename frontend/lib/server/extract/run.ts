// Server-side extraction (port of the extraction half of pipeline.process_document). Receives page text only,
// picks the extractor, verifies every value against the text (normalise) and returns the version payload or the
// failure the document should show. It keeps nothing between requests.
import "server-only";
import { EXTRACTION_MESSAGES } from "../../domain/workflow";
import { FIXTURE_EXTRACTOR, fixtureExtract } from "../../domain/extract/fixture";
import { pyStrip } from "../../domain/money";
import { normalise } from "../../domain/normalise";
import type { ExtractionConfig } from "../config";
import { GeminiBusy, type GeminiDeps, GeminiError, GeminiExtractor, defaultGeminiDeps } from "./gemini";

export type ExtractOutcome =
  | { ok: true; payload: ReturnType<typeof normalise> }
  | { ok: false; status: "unsupported" | "extraction_unavailable" | "extraction_failed"; detail: string };

export async function extractPages(pages: string[], opts: { rehearsal: boolean; config: ExtractionConfig;
  deps?: GeminiDeps }): Promise<ExtractOutcome> {
  const deps = opts.deps ?? defaultGeminiDeps();
  if (!pages.some((p) => pyStrip(p))) return { ok: false, status: "unsupported", detail: EXTRACTION_MESSAGES.unsupported };
  const { config } = opts;
  // Rehearsal mode (an administrator setting) uses the labelled TEST ADAPTER, never presented as AI (D15, D26).
  if (opts.rehearsal || config.mode === "test") {
    return { ok: true, payload: normalise(fixtureExtract(pages), pages, { name: FIXTURE_EXTRACTOR.name, isAi: false }) };
  }
  if (!config.apiKey || !config.model) {
    return { ok: false, status: "extraction_unavailable", detail: EXTRACTION_MESSAGES.extraction_unavailable };
  }
  const gemini = new GeminiExtractor(config.apiKey, config.model, config.fallbackModel, deps);
  try {
    const raw = await gemini.extract(pages);
    const payload = normalise(raw as Record<string, unknown>, pages, { name: gemini.name, isAi: true });
    deps.log(`extracted pages=${pages.length} lines=${payload.lines.length} extractor_ai=true`);
    return { ok: true, payload };
  } catch (exc) {
    const name = (exc as Error)?.name || "Error";
    deps.log(`extraction failed error=${name}`);
    const reason = exc instanceof GeminiBusy ? "the AI service is busy" : exc instanceof GeminiError ? exc.message : name;
    return { ok: false, status: "extraction_failed", detail: `Extraction failed (${reason}). Use Retry extraction.` };
  }
}
