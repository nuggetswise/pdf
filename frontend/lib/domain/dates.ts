// Printed dates to calendar dates (D59, D63). Purchase orders print dates every which way: 2026-11-20, 11/20/2026,
// 20/11/2026, November 20, 2026, Nov 20 2026, 20-Nov-2026, and EDI's 20261120. A numeric date is read only when one
// reading is possible: 11/20/2026 can only be month first and 20/11/2026 only day first, but 03/04/2026 could be
// either, so it returns null and the order waits for a person (D63; no US month-first assumption). A date with no
// year takes the year of a reference date (the PO date), rolling forward if that would put it more than two months
// before it. Anything ambiguous or unreadable returns null; a date is never guessed.

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");

function valid(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}
const monthOf = (word: string) => {
  const i = MONTHS.indexOf(word.slice(0, 3).toLowerCase());
  return i < 0 ? null : i + 1;
};

/** YYYY-MM-DD for a printed date, or null. `reference` (YYYY-MM-DD) supplies a missing year. */
export function isoDate(printed: string | null | undefined, reference?: string | null): string | null {
  if (!printed) return null;
  const t = printed.trim().replace(/\s+/g, " ").replace(/(\d)(st|nd|rd|th)\b/gi, "$1");
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(t);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2}|\d{4})$/.exec(t);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const [a, b] = [+m[1], +m[2]];
    if (a === b) return valid(y, a, b);
    if (a > 12) return valid(y, b, a); // day first
    if (b > 12) return valid(y, a, b); // month first
    return null; // both readings possible
  }
  m = /^(?:[A-Za-z]+,? )?([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/.exec(t);
  if (m && monthOf(m[1])) return valid(+m[3], monthOf(m[1])!, +m[2]);
  m = /^(\d{1,2})[ -]([A-Za-z]{3,9})\.?[ -](\d{2}|\d{4})$/.exec(t);
  if (m && monthOf(m[2])) return valid(m[3].length === 2 ? 2000 + +m[3] : +m[3], monthOf(m[2])!, +m[1]);
  m = /^([A-Za-z]{3,9})\.? (\d{1,2})$/.exec(t);
  if (m && monthOf(m[1]) && reference && /^\d{4}-\d{2}-\d{2}$/.test(reference)) {
    let y = +reference.slice(0, 4);
    const guess = valid(y, monthOf(m[1])!, +m[2]);
    if (guess && Date.parse(guess) < Date.parse(reference) - 62 * 86_400_000) y += 1;
    return valid(y, monthOf(m[1])!, +m[2]);
  }
  return null;
}

/** A printed range such as "Nov 10 - Nov 17, 2026" or "11/10/2026 to 11/17/2026", as two dates. */
export function isoRange(printed: string | null | undefined, reference?: string | null): { from: string | null; to: string | null } {
  if (!printed) return { from: null, to: null };
  const parts = printed.split(/\s+(?:-|–|to|through|thru)\s+/i);
  if (parts.length !== 2) return { from: isoDate(printed, reference), to: null };
  const to = isoDate(parts[1], reference);
  const from = isoDate(parts[0], to ?? reference);
  return { from, to };
}

export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const isWorkday = (d: string) => weekday(d) !== 0 && weekday(d) !== 6;

/** n working days after d (Monday to Friday; public holidays are not modelled). 0 moves a weekend to Monday. */
export function addWorkdays(d: string, n: number): string {
  let out = d;
  while (!isWorkday(out)) out = addDays(out, 1);
  for (let i = 0; i < n; i++) {
    out = addDays(out, 1);
    while (!isWorkday(out)) out = addDays(out, 1);
  }
  return out;
}
/** n working days before d. */
export function subtractWorkdays(d: string, n: number): string {
  let out = d;
  for (let i = 0; i < n; i++) {
    out = addDays(out, -1);
    while (!isWorkday(out)) out = addDays(out, -1);
  }
  return out;
}
export const maxDate = (...ds: (string | null | undefined)[]) => ds.filter(Boolean).sort().at(-1) ?? null;
export const minDate = (...ds: (string | null | undefined)[]) => ds.filter(Boolean).sort()[0] ?? null;

/** "Fri, Nov 20" for screens. */
export const showDate = (d: string | null | undefined) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d)
  ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : "—");

/** D63: what a printed date can mean. "ambiguous" lists both calendar readings; "unclear" covers relative or
 *  unreadable dates such as "Thursday" or "next week". */
export type DateReading = { kind: "date"; iso: string } | { kind: "ambiguous"; candidates: string[] } | { kind: "unclear" };
export function readDate(printed: string, reference?: string | null): DateReading {
  const iso = isoDate(printed, reference);
  if (iso) return { kind: "date", iso };
  const m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2}|\d{4})$/.exec(printed.trim());
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const both = [valid(y, +m[1], +m[2]), valid(y, +m[2], +m[1])].filter((d): d is string => d !== null);
    if (both.length === 2) return { kind: "ambiguous", candidates: both };
  }
  return { kind: "unclear" };
}
