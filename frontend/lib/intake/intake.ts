// Browser intake: turns a forwarded .eml or an uploaded PDF into what workflow.receive() stores.
// Every attachment is checked before anything is returned, so a rejected email leaves the run unchanged
// (intake.store_intake). PDF bytes are returned separately for the side-by-side view and never enter RunState.
import type { IncomingDocument, IncomingEnvelope } from "../domain/workflow";
import { parseEml } from "./eml";
import { MAX_UPLOAD_BYTES, type PdfJs, readPdf, sha256Hex } from "./pdf";

export interface Intake { envelope: IncomingEnvelope; attachments: IncomingDocument[]; pdfBytes: Uint8Array[] }
export interface IntakeOptions { pdfjs: PdfJs; maxBytes?: number }

/** Display-only filename (intake.safe_display_name): last path segment, letters, digits and "._- " only. */
export function safeDisplayName(name: string | null | undefined): string | null {
  if (!name) return null;
  const segment = name.replace(/\/+$/, "").split("/").pop() ?? "";
  const kept = Array.from(segment === "." ? "" : segment).filter((ch) => /^[\p{L}\p{N}._\- ]$/u.test(ch));
  return kept.slice(0, 120).join("") || null;
}

async function check(files: { filename: string | null; data: Uint8Array }[], opts: IntakeOptions) {
  const out: { document: IncomingDocument; bytes: Uint8Array }[] = [];
  for (const f of files) {
    const { pageCount, pageText } = await readPdf(f.data, opts.pdfjs, opts.maxBytes ?? MAX_UPLOAD_BYTES);
    out.push({ bytes: f.data, document: { originalFilename: safeDisplayName(f.filename), sha256: await sha256Hex(f.data),
      sizeBytes: f.data.length, pageCount, pageText } });
  }
  return out;
}

/** A forwarded .eml: a demo inbox email ("local_forward_demo") or one the user imports ("eml_import"). */
export async function intakeEml(raw: Uint8Array, mode: "eml_import" | "local_forward_demo", opts: IntakeOptions):
  Promise<Intake> {
  const email = await parseEml(raw, opts.maxBytes ?? MAX_UPLOAD_BYTES);
  const checked = await check(email.attachments, opts);
  return {
    envelope: { ...email.envelope, intakeMode: mode, rawSha256: await sha256Hex(raw) },
    attachments: checked.map((c) => c.document), pdfBytes: checked.map((c) => c.bytes),
  };
}

/** A PDF uploaded with a typed sender and optional subject (the prototype's demo envelope). */
export async function intakeUpload(pdf: Uint8Array, filename: string | null, fields: { sender: string; subject?: string | null },
  opts: IntakeOptions): Promise<Intake> {
  const checked = await check([{ filename, data: pdf }], opts);
  return {
    envelope: { messageId: null, sender: fields.sender || null, receivedAt: null, subjectMetadata: fields.subject || null,
      intakeMode: "demo_envelope_upload", rawSha256: null },
    attachments: checked.map((c) => c.document), pdfBytes: checked.map((c) => c.bytes),
  };
}

/** The bundled fictional demo inbox, served from public/demo/. Any other name is refused. */
export const DEMO_EMAILS = ["VIDEO-DEMO-001", "VIDEO-DEMO-002", "VIDEO-DEMO-003", "VIDEO-DEMO-004",
  "VIDEO-DEMO-005"] as const;
export type DemoEmail = (typeof DEMO_EMAILS)[number];

/** What each sample shows, in the words a supplier would use. */
export const SAMPLE_LABELS: Record<DemoEmail, string> = {
  "VIDEO-DEMO-001": "Order with 3 problems (price, minimum quantity, retired item)",
  "VIDEO-DEMO-002": "Repeat order the agent fixes from memory",
  "VIDEO-DEMO-003": "Another retailer, same retired item",
  "VIDEO-DEMO-004": "Order after a memory rule is turned off",
  "VIDEO-DEMO-005": "Clean order, no problems",
};

export function demoEmailPath(name: string): string | null {
  return (DEMO_EMAILS as readonly string[]).includes(name) ? `/demo/${name}.eml` : null;
}
