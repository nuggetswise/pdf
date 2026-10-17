// Server-side extraction (port of the extraction half of pipeline.process_document). Receives page text only,
// picks the extractor, verifies every value against the text (normalise) and returns the version payload or the
// failure the document should show. It keeps nothing between requests.
import "server-only";
import { EXTRACTION_MESSAGES } from "../../domain/workflow";
import { FIXTURE_EXTRACTOR, fixtureExtractAny } from "../../domain/extract/fixture";
import { EMAIL_TEXT_READER, emailTextExtract } from "../../domain/extract/email-text";
import { read850 } from "../../domain/extract/x12-850";
import type { Classification } from "../../domain/workflow";
import { pyStrip } from "../../domain/money";
import { normalise } from "../../domain/normalise";
import type { ExtractionConfig } from "../config";
import { GeminiBusy, type GeminiDeps, GeminiError, GeminiExtractor, defaultGeminiDeps } from "./gemini";

export type ExtractOutcome =
  | { ok: true; payload: ReturnType<typeof normalise>; transcript?: string[]; classification: Classification }
  | { ok: false; status: "unsupported" | "extraction_unavailable" | "extraction_failed"; detail: string };
export type SourceKind = "pdf" | "email_body" | "edi";

/** D62: a deterministic floor under any reader's classification. A reading with a PO number and at least one line
 *  is never set aside as "not an order" without a person; one with neither is never treated as an order. */
export function classify(payload: ReturnType<typeof normalise>, said?: { type?: unknown; reason?: unknown }): Classification {
  const po = Boolean(payload.header.po_number.value);
  const lines = payload.lines.some((l) => l.quantity.value || l.supplier_sku?.value || l.gtin.value || l.customer_item_code.value);
  const reason = typeof said?.reason === "string" && said.reason.trim() ? said.reason.trim().slice(0, 300) : null;
  if (po && lines) return { result: "order", reason: reason ?? "PO number and order lines found." };
  if (said?.type === "purchase_order" && (po || lines)) return { result: "order", reason: reason ?? "Read as a purchase order." };
  if (!po && !lines) return { result: "not_order", reason: reason ?? "No PO number and no order lines found." };
  return { result: said?.type === "not_an_order" ? "not_order" : "order",
    reason: reason ?? (po ? "PO number found, no order lines." : "Order lines found, no PO number.") };
}

export async function extractPages(pages: string[], opts: { rehearsal: boolean; config: ExtractionConfig;
  deps?: GeminiDeps; pdf?: string | null; images?: string[] | null; kind?: SourceKind }): Promise<ExtractOutcome> {
  const deps = opts.deps ?? defaultGeminiDeps();
  const kind = opts.kind ?? "pdf";
  // D62: a structured order is read from its segments. The AI never sees it.
  if (kind === "edi") {
    const payload = read850(pages);
    if (!payload) return { ok: true, payload: normalise({}, pages, { name: "Structured X12 850 reader (no AI)", isAi: false }),
      classification: { result: "not_order", reason: "The EDI file holds no purchase order (850)." } };
    return { ok: true, payload, classification: classify(payload) };
  }
  if (kind === "email_body" && !pages.some((p) => pyStrip(p))) {
    return { ok: true, payload: normalise({}, pages, { name: "Intake", isAi: false }),
      classification: { result: "not_order", reason: "The email has no text and no attachment that can carry an order." } };
  }
  const scanned = kind === "pdf" && !pages.some((p) => pyStrip(p));
  // A scan can only be read by the AI from page images; the test adapter and a request without images cannot.
  if (scanned && (!opts.images?.length || opts.rehearsal || opts.config.mode === "test")) {
    return { ok: false, status: "unsupported", detail: EXTRACTION_MESSAGES.unsupported };
  }
  const { config } = opts;
  // Rehearsal mode (an administrator setting) uses the labelled TEST ADAPTER, never presented as AI (D15, D26).
  if (opts.rehearsal || config.mode === "test") {
    const payload = kind === "email_body"
      ? normalise(emailTextExtract(pages), pages, { name: EMAIL_TEXT_READER.name, isAi: false })
      : normalise(fixtureExtractAny(pages), pages, { name: FIXTURE_EXTRACTOR.name, isAi: false });
    return { ok: true, payload, classification: classify(payload) };
  }
  if (!config.apiKey || !config.model) {
    return { ok: false, status: "extraction_unavailable", detail: EXTRACTION_MESSAGES.extraction_unavailable };
  }
  const gemini = new GeminiExtractor(config.apiKey, config.model, config.fallbackModel, deps);
  try {
    const raw = await gemini.extract(pages, scanned ? { images: opts.images } : { pdf: kind === "pdf" ? opts.pdf : null, emailText: kind === "email_body" });
    const said = { type: (raw as { document_type?: unknown })?.document_type, reason: (raw as { document_type_reason?: unknown })?.document_type_reason };
    if (scanned) {
      const transcript = transcriptOf(raw, pages.length);
      if (!transcript) return { ok: false, status: "extraction_failed", detail: "Extraction failed (the AI returned no page text for the scan). Use Retry extraction." };
      const payload = { ...normalise(raw as Record<string, unknown>, transcript, { name: gemini.name, isAi: true }), source: "scan" as const };
      deps.log(`extracted scan pages=${pages.length} lines=${payload.lines.length} extractor_ai=true`);
      return { ok: true, payload, transcript, classification: classify(payload, said) };
    }
    const payload = normalise(raw as Record<string, unknown>, pages, { name: gemini.name, isAi: true });
    deps.log(`extracted pages=${pages.length} lines=${payload.lines.length} extractor_ai=true pdf=${opts.pdf ? "sent" : "not_sent"}`);
    return { ok: true, payload, classification: classify(payload, said) };
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
