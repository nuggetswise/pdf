// Server settings from environment variables (Vercel env vars in deployment). Secrets have no defaults and are
// never logged. Only code under lib/server/ may read the Gemini key; a test enforces that.
import "server-only";

export interface ExtractionConfig {
  mode: string; // "gemini" (default) or "test" (always the labelled TEST ADAPTER)
  apiKey: string | null;
  model: string | null;
  fallbackModel: string | null;
}

export function loadExtractionConfig(env: Record<string, string | undefined> = process.env): ExtractionConfig {
  return {
    mode: env.ORDER_AGENT_EXTRACTOR || "gemini",
    apiKey: env.GEMINI_API_KEY || null,
    model: env.GEMINI_MODEL || null,
    fallbackModel: env.GEMINI_FALLBACK_MODEL || null,
  };
}

export const extractionAvailable = (c: ExtractionConfig) => c.mode === "test" || Boolean(c.apiKey && c.model);

/** What /api/health reported about extraction. It says whether a key is set, never the key. */
export function extractionHealth(c: ExtractionConfig) {
  return {
    extraction: extractionAvailable(c) ? "available" : "unavailable",
    extractor_mode: c.mode,
    model: c.mode === "gemini" ? c.model : null,
  };
}
