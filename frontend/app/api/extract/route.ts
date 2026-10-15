// Extraction route. POST takes page text (never the PDF) and returns the extracted, evidence-checked version
// or the failure to show. GET reports whether extraction is available, without revealing the key.
// Until rebuild slice 5 the UI's other /api calls still go to FastAPI; this path does not exist there.
import { NextResponse } from "next/server";
import { z } from "zod";
import { MAX_PAGES } from "../../../lib/intake/pdf";
import { extractionHealth, loadExtractionConfig } from "../../../lib/server/config";
import { extractPages } from "../../../lib/server/extract/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A live Gemini call with retries and the fallback model can run for minutes (2026-10-15 rehearsal).
export const maxDuration = 300;

/** Vercel refuses request bodies over 4.5 MB; refuse earlier with a clear message. */
const MAX_BODY_BYTES = 4_000_000;
const Body = z.strictObject({ pages: z.array(z.string()).min(1).max(MAX_PAGES), rehearsal: z.boolean() });

export function GET() {
  return NextResponse.json(extractionHealth(loadExtractionConfig()));
}

export async function POST(request: Request) {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Page text exceeds the request size limit" }, { status: 413 });
  }
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = undefined; }
  const body = Body.safeParse(json);
  if (!body.success) return NextResponse.json({ error: "Expected {pages: string[], rehearsal: boolean}" }, { status: 400 });
  const outcome = await extractPages(body.data.pages, { rehearsal: body.data.rehearsal, config: loadExtractionConfig() });
  return NextResponse.json(outcome);
}
