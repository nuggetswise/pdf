// Browser intake: turns a forwarded .eml or an uploaded PDF into what workflow.receive() stores.
// Every attachment is checked before anything is returned, so a rejected email leaves the run unchanged
// (intake.store_intake). PDF bytes are returned separately for the side-by-side view and never enter RunState.
import type { IncomingDocument, IncomingEnvelope } from "../domain/workflow";
import { type EmailAttachment, parseEml } from "./eml";
import { IntakeRejected, MAX_UPLOAD_BYTES, type PdfJs, readPdf, sha256Hex } from "./pdf";

export interface SeenAttachment {
  filename: string | null; mimeType: string | null; sizeBytes: number; sha256: string;
  handling: "order_candidate" | "evidence_only"; note: string | null;
}
export interface Intake {
  envelope: IncomingEnvelope;
  /** Documents the agent reads: PDFs, an EDI order file, or the email text when nothing else carries an order. */
  attachments: IncomingDocument[];
  /** The PDF bytes for each entry in attachments, or null for an email text or EDI file. */
  pdfBytes: (Uint8Array | null)[];
  /** D62: the email's text and every attachment with what was done with it. Absent for a direct upload. */
  email?: { bodyText: string | null; seen: SeenAttachment[] };
}
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

const MAX_EDI_CHARS = 200_000;
const lower = (v: string | null) => (v ?? "").toLowerCase();
const isPdfFile = (a: EmailAttachment) => a.mimeType === "application/pdf" || lower(a.filename).endsWith(".pdf")
  || [0x25, 0x50, 0x44, 0x46, 0x2d].every((b, i) => a.data[i] === b);
/** An ANSI X12 interchange starts with ISA; files often end in .edi or .x12. */
export function ediText(data: Uint8Array): string | null {
  if (data.length > MAX_EDI_CHARS) return null;
  const text = new TextDecoder("utf-8", { fatal: false }).decode(data).replace(/^\uFEFF/, "").trim();
  return /^ISA[^A-Za-z0-9\s]/.test(text) ? text : null;
}
/** Why an attachment is kept as evidence only. Spreadsheet orders are a later step (D62). */
function evidenceNote(a: EmailAttachment): string {
  const n = lower(a.filename);
  const t = lower(a.mimeType);
  if (/\.(xlsx|xls|csv)$/.test(n) || t.includes("spreadsheet") || t.includes("excel") || t === "text/csv") {
    return "Spreadsheet orders are not read yet. Kept as evidence.";
  }
  if (t.startsWith("image/")) return "Image kept as evidence. Not read.";
  return "File type not read. Kept as evidence.";
}

/**
 * A forwarded .eml: a demo inbox email ("order_mailbox") or one the user imports ("eml_import").
 * D62: an email is never refused for lacking a PDF. Every attachment is listed; PDFs and EDI order files are read;
 * anything else, or a PDF that cannot be read, is kept as evidence with a note. When no attachment can carry an
 * order, the email's own text becomes the document the agent reads, so body and attachment never both make an order.
 */
export async function intakeEml(raw: Uint8Array, mode: "eml_import" | "order_mailbox", opts: IntakeOptions):
  Promise<Intake> {
  const email = await parseEml(raw, opts.maxBytes ?? MAX_UPLOAD_BYTES);
  const docs: IncomingDocument[] = [];
  const bytes: (Uint8Array | null)[] = [];
  const seen: SeenAttachment[] = [];
  for (const a of email.attachments) {
    const base = { filename: safeDisplayName(a.filename), mimeType: a.mimeType, sizeBytes: a.data.length, sha256: await sha256Hex(a.data) };
    const edi = !isPdfFile(a) ? ediText(a.data) : null;
    if (isPdfFile(a)) {
      try {
        const [checked] = await check([a], opts);
        docs.push(checked.document);
        bytes.push(checked.bytes);
        seen.push({ ...base, handling: "order_candidate", note: null });
      } catch (exc) {
        if (!(exc instanceof IntakeRejected)) throw exc;
        seen.push({ ...base, handling: "evidence_only", note: `${exc.message}. Kept as evidence.` });
      }
    } else if (edi) {
      docs.push({ originalFilename: base.filename, sha256: base.sha256, sizeBytes: base.sizeBytes, pageCount: 1, pageText: [edi], kind: "edi" });
      bytes.push(null);
      seen.push({ ...base, handling: "order_candidate", note: null });
    } else {
      seen.push({ ...base, handling: "evidence_only", note: evidenceNote(a) });
    }
  }
  if (!docs.length) {
    const text = email.bodyText;
    const data = new TextEncoder().encode(text);
    docs.push({ originalFilename: null, sha256: await sha256Hex(text ? data : raw), sizeBytes: data.length, pageCount: 1,
      pageText: [text], kind: "email_body" });
    bytes.push(null);
  }
  return {
    envelope: { ...email.envelope, intakeMode: mode, rawSha256: await sha256Hex(raw) },
    attachments: docs, pdfBytes: bytes, email: { bodyText: email.bodyText || null, seen },
  };
}

/** D62: an EDI order file uploaded directly (a structured order; the AI never reads it). */
export async function intakeEdi(data: Uint8Array, filename: string | null): Promise<Intake> {
  const text = ediText(data);
  if (!text) throw new IntakeRejected("invalid", "File is not an X12 interchange");
  return {
    envelope: { messageId: null, sender: null, receivedAt: null, subjectMetadata: null, intakeMode: "manual_upload", rawSha256: null },
    attachments: [{ originalFilename: safeDisplayName(filename), sha256: await sha256Hex(data), sizeBytes: data.length, pageCount: 1,
      pageText: [text], kind: "edi" }],
    pdfBytes: [null],
  };
}

/** A PDF uploaded with a typed sender and optional subject (the prototype's demo envelope). */
export async function intakeUpload(pdf: Uint8Array, filename: string | null, fields: { sender: string; subject?: string | null },
  opts: IntakeOptions): Promise<Intake> {
  const checked = await check([{ filename, data: pdf }], opts);
  return {
    envelope: { messageId: null, sender: fields.sender || null, receivedAt: null, subjectMetadata: fields.subject || null,
      intakeMode: "manual_upload", rawSha256: null },
    attachments: checked.map((c) => c.document), pdfBytes: checked.map((c) => c.bytes),
  };
}

/** The supplier's own intake address (fictional). In production a supplier sets one auto-forward rule on the mailbox
 *  that receives retailer purchase orders, to this address; retailers can also send to it directly. */
export const INTAKE_ADDRESS = "northernfoods-7k2p@orders.tradinggrid.example";

/** The two fictional Maple emails the test environment can receive, served from public/samples/. Any other name is refused. */
export const SAMPLE_EMAILS = ["PO-2026-104620", "PO-2026-104633"] as const;
export type SampleEmail = (typeof SAMPLE_EMAILS)[number];

/** What each email is, in the words a supplier would use. */
export const SAMPLE_LABELS: Record<SampleEmail, string> = {
  "PO-2026-104620": "Maple Retail Group · PO-2026-104620 · Milk",
  "PO-2026-104633": "Maple Retail Group · PO-2026-104633 · Cheese",
};
/** Who sent the fictional email, from its own headers. */
export const SAMPLE_SENDERS: Record<SampleEmail, string> = {
  "PO-2026-104620": "procurement@mapleretail.example",
  "PO-2026-104633": "procurement@mapleretail.example",
};

export function sampleEmailPath(name: string): string | null {
  return (SAMPLE_EMAILS as readonly string[]).includes(name) ? `/samples/${name}.eml` : null;
}
