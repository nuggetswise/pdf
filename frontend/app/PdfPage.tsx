"use client";
// The purchase order as it looks (D58): each PDF page drawn as it prints, with a box on every value the agent read.
// Clicking a box selects that value; selecting an issue or an order line in the review highlights its boxes.
// Rendering runs in pdf.js's worker with scripts and forms off; nothing in the document is executed.
import "../lib/intake/pdfjs-polyfill";
import { useEffect, useMemo, useRef, useState } from "react";
import { type Box, type Target, type TextRun, locateValues } from "../lib/intake/page-boxes";
import { useAgent } from "./run/RunProvider";

export type BoxTone = "value" | "issue" | "focus";
export interface PageTarget extends Target { label: string; tone: "value" | "issue" }

type PdfModule = typeof import("pdfjs-dist");
let pdfjs: Promise<PdfModule> | null = null;
const loadPdfjs = () => {
  pdfjs ??= import("pdfjs-dist").then((m) => {
    m.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    return m;
  });
  return pdfjs;
};

interface Rendered { width: number; height: number; scale: number; image: string; runs: TextRun[] }

/** Draw every page once at a fixed resolution; the image scales with the panel, the boxes are in page points. */
async function renderPages(bytes: Uint8Array): Promise<Rendered[]> {
  const m = await loadPdfjs();
  const task = m.getDocument({ data: bytes.slice(), verbosity: 0, enableXfa: false });
  const doc = await task.promise;
  try {
    const out: Rendered[] = [];
    for (let i = 1; i <= Math.min(doc.numPages, 20); i++) {
      const page = await doc.getPage(i);
      const scale = 2;
      const vp = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport: vp, annotationMode: 0 }).promise;
      const content = await page.getTextContent();
      const runs: TextRun[] = content.items.flatMap((it) => ("str" in it && it.str.trim()
        ? [{ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height || Math.abs(it.transform[3]) }] : []));
      const base = page.getViewport({ scale: 1 });
      out.push({ width: base.width, height: base.height, scale: 1, image: canvas.toDataURL("image/png"), runs });
      page.cleanup();
    }
    return out;
  } finally {
    await task.destroy();
  }
}

export function PdfPage({ docId, targets, focus, onPick, pageText, scanned }: {
  docId: number; targets: PageTarget[]; focus: Set<string>; onPick?: (id: string) => void; pageText: string[] | null; scanned: boolean;
}) {
  const agent = useAgent();
  const [pages, setPages] = useState<Rendered[] | null>(null);
  const [missing, setMissing] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    setPages(null);
    setMissing(false);
    agent.pdfBytes(docId).then(async (bytes) => {
      if (!bytes) { if (live) setMissing(true); return; }
      const r = await renderPages(bytes);
      if (live) setPages(r);
    }).catch((e) => { console.error("pdf page view failed", e); if (live) setMissing(true); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  const boxes = useMemo<Box[]>(() => (pages ? locateValues(pages.map((p) => p.runs), targets) : []), [pages, targets]);
  const byId = useMemo(() => new Map(targets.map((t) => [t.id, t])), [targets]);

  // Bring the selected value into view.
  useEffect(() => {
    if (!focus.size || !wrap.current) return;
    const el = wrap.current.querySelector<HTMLElement>(".vbox.focus");
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focus, boxes]);

  if (missing) {
    return (
      <div className="pdfview" aria-label="Purchase order">
        <p className="muted small">Original PDF unavailable in this browser. Showing extracted text.</p>
        <div className="pagetext">{(pageText ?? []).map((t, i) => <pre key={i}>{t}</pre>)}</div>
      </div>
    );
  }
  if (!pages) return <div className="pdfview loading" aria-label="Purchase order"><p className="muted">Opening the PDF…</p></div>;
  const found = new Set(boxes.map((b) => b.id));
  return (
    <div className="pdfview" ref={wrap} aria-label="Purchase order">
      {scanned && <p className="scan-note">Scanned PDF. Verify each value against the page before approval.</p>}
      {!scanned && <p className="muted small legend"><span className="key value" /> read by the agent <span className="key issue" /> needs a decision
        {targets.length > found.size && <> · {targets.length - found.size} value{targets.length - found.size === 1 ? "" : "s"} not printed as text</>}</p>}
      {pages.map((p, i) => (
        <div key={i} className="pdfpage" style={{ aspectRatio: `${p.width} / ${p.height}` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.image} alt={`Page ${i + 1} of the purchase order`} />
          {boxes.filter((b) => b.page === i + 1).map((b) => {
            const t = byId.get(b.id)!;
            const tone: BoxTone = focus.has(b.id) ? "focus" : t.tone;
            return (
              <button key={b.id} type="button" className={`vbox ${tone}`} title={`${t.label}: ${t.value}`} aria-label={`${t.label}: ${t.value}`}
                onClick={() => onPick?.(b.id)}
                style={{ left: `${(b.x / p.width) * 100}%`, top: `${((p.height - b.y - b.h) / p.height) * 100}%`,
                  width: `${(b.w / p.width) * 100}%`, height: `${(b.h / p.height) * 100}%` }} />
            );
          })}
        </div>
      ))}
    </div>
  );
}
