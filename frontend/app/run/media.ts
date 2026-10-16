// What goes to the AI with the page text (D59): the PDF itself, so the model sees the layout, or for a scan
// (no text layer) the pages as images. Large files fall back to text only, inside the server's request limit.
import "../../lib/intake/pdfjs-polyfill";
import { MAX_PAGES } from "../../lib/intake/pdf";

/** Base64 of up to about 2.6 MB of PDF keeps the request under the 4 MB the route accepts. */
const MAX_PDF_BYTES = 2_600_000;
const MAX_IMAGE_CHARS = 3_400_000;

function base64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function pageImages(bytes: Uint8Array): Promise<string[]> {
  const m = await import("pdfjs-dist");
  m.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const task = m.getDocument({ data: bytes.slice(), verbosity: 0, enableXfa: false });
  const doc = await task.promise;
  try {
    const out: string[] = [];
    let total = 0;
    for (let i = 1; i <= Math.min(doc.numPages, MAX_PAGES); i++) {
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 1.6 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport: vp, annotationMode: 0 }).promise;
      const data = canvas.toDataURL("image/jpeg", 0.72).split(",")[1] ?? "";
      if (total + data.length > MAX_IMAGE_CHARS) break;
      total += data.length;
      out.push(data);
    }
    return out;
  } finally {
    await task.destroy();
  }
}

export async function mediaFor(bytes: Uint8Array | null, pageText: string[]): Promise<{ pdf?: string; images?: string[] }> {
  if (!bytes) return {};
  try {
    if (!pageText.some((p) => p.trim())) return { images: await pageImages(bytes) };
    return bytes.length <= MAX_PDF_BYTES ? { pdf: base64(bytes) } : {};
  } catch {
    return {};
  }
}
