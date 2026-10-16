// Where each value the agent read sits on the PDF page (D58). pdf.js gives every text run on a page with its
// position; this finds the run (or the few neighbouring runs) that print a value, so the page view can draw a box
// around it. Pure and layout-agnostic: it never assumes a column order or label wording, only the printed text.

/** One text run in PDF space: x, y is the baseline start, w and h its width and height (points). */
export interface TextRun { str: string; x: number; y: number; w: number; h: number }
/** A value to find. Line fields share a group (the order line) so they are found on the same row. */
export interface Target { id: string; value: string; page: number | null; group?: string | null; anchor?: boolean }
export interface Box { id: string; page: number; x: number; y: number; w: number; h: number }

const squash = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
const digitsOnly = (t: string) => /^[\d.,]+$/.test(t);

interface Hit { page: number; runs: TextRun[]; y: number; exact: boolean }

/** Every place on a page where the needle is printed: one run that is or contains it, or neighbouring runs that spell it. */
function hitsOnPage(runs: TextRun[], page: number, needle: string): Hit[] {
  const hits: Hit[] = [];
  const short = needle.length < 4 || digitsOnly(needle);
  runs.forEach((r) => {
    const s = squash(r.str);
    if (!s) return;
    if (s === needle) hits.push({ page, runs: [r], y: r.y, exact: true });
    // Short or numeric values only count as a whole word ("5" must not match "15" or "2026-10-25").
    else if (short ? new RegExp(`(^|[^\\d.,])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\d.,])`).test(s) : s.includes(needle)) {
      hits.push({ page, runs: [r], y: r.y, exact: false });
    }
  });
  if (hits.length || short) return hits;
  // A value printed across several runs on one row, such as an address or a description split by the PDF writer.
  for (let i = 0; i < runs.length; i++) {
    let text = squash(runs[i].str);
    for (let j = i + 1; j < Math.min(runs.length, i + 8) && text.length < needle.length + 40; j++) {
      text = `${text} ${squash(runs[j].str)}`.trim();
      if (text.includes(needle)) { hits.push({ page, runs: runs.slice(i, j + 1), y: runs[i].y, exact: false }); break; }
    }
  }
  return hits;
}

const union = (id: string, h: Hit): Box => {
  const x = Math.min(...h.runs.map((r) => r.x));
  const y = Math.min(...h.runs.map((r) => r.y));
  const right = Math.max(...h.runs.map((r) => r.x + r.w));
  const top = Math.max(...h.runs.map((r) => r.y + r.h));
  return { id, page: h.page, x, y, w: right - x, h: top - y };
};

/** Boxes for the targets that could be found; a value not printed as text (a scan) simply gets no box. */
export function locateValues(pages: TextRun[][], targets: Target[]): Box[] {
  const out: Box[] = [];
  const rowOf = new Map<string, { page: number; y: number }>();
  const find = (t: Target) => {
    const needle = squash(t.value);
    if (!needle) return [];
    const where = t.page && pages[t.page - 1] ? [t.page] : pages.map((_, i) => i + 1);
    return where.flatMap((p) => hitsOnPage(pages[p - 1], p, needle));
  };
  // Anchors first (a line's description or product code), so the line's other values are taken from that row.
  const ordered = [...targets].sort((a, b) => Number(!!b.anchor) - Number(!!a.anchor));
  for (const t of ordered) {
    const hits = find(t);
    if (!hits.length) continue;
    const row = t.group ? rowOf.get(t.group) : undefined;
    let best: Hit;
    if (row) {
      const near = hits.filter((h) => h.page === row.page);
      const pool = near.length ? near : hits;
      best = pool.reduce((a, b) => (Math.abs(b.y - row.y) < Math.abs(a.y - row.y) ? b : a));
      if (Math.abs(best.y - row.y) > 24) continue; // not on this line's row: no box rather than a wrong one
    } else {
      best = hits.find((h) => h.exact) ?? hits[0];
    }
    if (t.group && !rowOf.has(t.group)) rowOf.set(t.group, { page: best.page, y: best.y });
    out.push(union(t.id, best));
  }
  return out;
}
