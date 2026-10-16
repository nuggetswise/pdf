// pdf.js for the browser, loaded on first use so it stays out of the initial page bundle.
// Wired into the UI in rebuild slice 5; the Node build of the same library is what the tests use.
import "./pdfjs-polyfill";
import type { PdfJs } from "./pdf";

let loaded: Promise<PdfJs> | null = null;

export function browserPdfjs(): Promise<PdfJs> {
  loaded ??= import("pdfjs-dist").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    return pdfjs;
  });
  return loaded;
}
