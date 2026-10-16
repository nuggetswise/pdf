// Server-side extraction (port of the extraction half of pipeline.process_document). Receives page text only,
// picks the extractor, verifies every value against the text (normalise) and returns the version payload or the
// failure the document should show. It keeps nothing between requests.
import "server-only";
import { EXTRACTION_MESSAGES } from "../../domain/workflow";
import { FIXTURE_EXTRACTOR, fixtureExtractAny } from "../../domain/extract/fixture";
import { pyStrip } from "../../domain/money";
import { normalise } from "../../domain/normalise";
import type { ExtractionConfig } from "../config";
import { GeminiBusy, type GeminiDeps, GeminiError, GeminiExtractor, defaultGeminiDeps } from "./gemini";

export type ExtractOutcome =
  | { ok: true; payload: ReturnType<typeof normalise>; transcript?: string[] }
  | { ok: false; status: "unsupported" | "extraction_unavailable" | "extraction_failed"; detail: string };

export async function extractPages(pages: string[], opts: { rehearsal: boolean; config: ExtractionConfig;
  deps?: GeminiDeps; pdf?: string | null; images?: string[] | null }): Promise<ExtractOutcome> {
  const deps = opts.deps ?? defaultGeminiDeps();
  const scanned = !pages.some((p) => pyStrip(p));
  // A scan can only be read by the AI from page images; the test adapter and a request without images cannot.
  if (scanned && (!opts.images?.length || opts.rehearsal || opts.config.mode === "test")) {
    return { ok: false, status: "unsupported", detail: EXTRACTION_MESSAGES.unsupported };
  }
  const { config } = opts;
  // Rehearsal mode (an administrator setting) uses the labelled TEST ADAPTER, never presented as AI (D15, D26).
  if (opts.rehearsal || config.mode === "test") {
    return { ok: true, payload: normalise(fixtureExtractAny(pages), pages, { name: FIXTURE_EXTRACTOR.name, isAi: false }) };
  }
  if (!config.apiKey || !config.model) {
    return { ok: false, status: "extraction_unavailable", detail: EXTRACTION_MESSAGES.extraction_unavailable };
  }
  const gemini = new GeminiExtractor(config.apiKey, config.model, config.fallbackModel, deps);
  try {
    const raw = await gemini.extract(pages, scanned ? { images: opts.images } : { pdf: opts.pdf });
    if (scanned) {
      const transcript = transcriptOf(raw, pages.length);
      if (!transcript) return { ok: false, status: "extraction_failed", detail: "Extraction failed (the AI returned no page text for the scan). Use Retry extraction." };
      const payload = { ...normalise(raw as Record<string, unknown>, transcript, { name: gemini.name, isAi: true }), source: "scan" as const };
      deps.log(`extracted scan pages=${pages.length} lines=${payload.lines.length} extractor_ai=true`);
      return { ok: true, payload, transcript };
    }
    const payload = normalise(raw as Record<string, unknown>, pages, { name: gemini.name, isAi: true });
    deps.log(`extracted pages=${pages.length} lines=${payload.lines.length} extractor_ai=true pdf=${opts.pdf ? "sent" : "not_sent"}`);
    return { ok: true, payload };
  } catch (exc) {
    const name = (exc as Error)?.name || "Error";
    deps.log(`extraction failed error=${name}`);
    const reason = exc instanceof GeminiBusy ? "the AI service is busy" : exc instanceof GeminiError ? exc.message : name;
    return { ok: false, status: "extraction_failed", detail: `Extraction failed (${reason}). Use Retry extraction.` };
  }
}

/** The AI's transcription of a scan, one string per page, or null when it gave none. */
export function transcriptOf(raw: unknown, pageCount: number): string[] | null {
  const t = (raw as { transcript?: unknown })?.transcript;
  if (!Array.isArray(t)) return null;
  const out = Array.from({ length: pageCount }, () => "");
  for (const row of t) {
    const r = row as { page?: unknown; text?: unknown };
    if (typeof r?.page === "number" && Number.isInteger(r.page) && r.page >= 1 && r.page <= pageCount && typeof r.text === "string") {
      out[r.page - 1] = (out[r.page - 1] ? `${out[r.page - 1]}\n` : "") + r.text.slice(0, 50_000);
    }
  }
  return out.some((p) => p.trim()) ? out : null;
}
