// Browser-side PDF checks and page text (port of intake._check_pdf and extraction.read_pdf_pages).
// The PDF never leaves the browser: only its page text and SHA-256 are kept in the run (D30).
// pdf.js is passed in, so the same code runs with the browser build and, in tests, the Node build.
import type { getDocument } from "pdfjs-dist";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_PAGES = 50;

/** Input refused before anything is stored. "too_large" was HTTP 413 in the prototype; "invalid" was 422. */
export class IntakeRejected extends Error {
  constructor(readonly kind: "too_large" | "invalid", message: string) { super(message); this.name = "IntakeRejected"; }
}

export interface PdfJs { getDocument: typeof getDocument }

export interface PdfReading { pageCount: number; pageText: string[] }

const MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

/** Check one PDF and read its native text. Never renders and never runs the document's scripts. */
export async function readPdf(data: Uint8Array, pdfjs: PdfJs, maxBytes = MAX_UPLOAD_BYTES): Promise<PdfReading> {
  if (data.length > maxBytes) throw new IntakeRejected("too_large", `PDF exceeds ${maxBytes} byte limit`);
  if (!MAGIC.every((b, i) => data[i] === b)) throw new IntakeRejected("invalid", "Attachment is not a PDF");
  // pdf.js takes ownership of the buffer it is given, so it gets a copy.
  const task = pdfjs.getDocument({ data: data.slice(), verbosity: 0, disableFontFace: true, useSystemFonts: false,
    enableXfa: false, stopAtErrors: true });
  let doc: Awaited<typeof task.promise>;
  try {
    doc = await task.promise;
  } catch (exc) {
    await task.destroy();
    if ((exc as Error)?.name === "PasswordException") throw new IntakeRejected("invalid", "Encrypted PDFs are not accepted");
    throw new IntakeRejected("invalid", "PDF could not be read");
  }
  try {
    // A PDF encrypted with an empty password opens without asking; it still carries permissions, and is refused.
    if ((await doc.getPermissions()) !== null) throw new IntakeRejected("invalid", "Encrypted PDFs are not accepted");
    const pageCount = doc.numPages;
    if (pageCount === 0) throw new IntakeRejected("invalid", "PDF has no pages");
    if (pageCount > MAX_PAGES) throw new IntakeRejected("invalid", `PDF exceeds ${MAX_PAGES} page limit`);
    const pageText: string[] = [];
    for (let i = 1; i <= pageCount; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      pageText.push(content.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : "") : "")).join(""));
    }
    return { pageCount, pageText };
  } catch (exc) {
    if (exc instanceof IntakeRejected) throw exc;
    throw new IntakeRejected("invalid", "PDF could not be read");
  } finally {
    await task.destroy();
  }
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
