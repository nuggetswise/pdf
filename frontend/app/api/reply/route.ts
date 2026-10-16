// D54: POST a supplier's reply text and the PO lines; returns the proposed, evidence-checked changes.
import { NextResponse } from "next/server";
import { z } from "zod";
import { MAX_REPLY_CHARS } from "../../../lib/domain/reply";
import { loadExtractionConfig } from "../../../lib/server/config";
import { readReply } from "../../../lib/server/reply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const s = z.string().max(500);
const Body = z.strictObject({
  text: z.string().min(1).max(MAX_REPLY_CHARS),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rehearsal: z.boolean(),
  lines: z.array(z.strictObject({ sourceLineId: s, description: s.nullable(), quantity: s.nullable(), unit: s.nullable(),
    unitPrice: s.nullable() })).min(1).max(200),
});

export async function POST(request: Request) {
  let json: unknown;
  try { json = await request.json(); } catch { json = undefined; }
  const body = Body.safeParse(json);
  if (!body.success) return NextResponse.json({ ok: false, detail: "Write a reply of up to 4,000 characters." }, { status: 400 });
  const { text, lines, today, rehearsal } = body.data;
  return NextResponse.json(await readReply(text, lines, today, { rehearsal, config: loadExtractionConfig() }));
}
