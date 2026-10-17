// Checks added on top of the Python parity port (validation.ts), applied to its result in workflow.evaluate (D63, D65).
// validate() stays byte-compatible with the Python prototype; everything here only adds issues, adds choices to
// existing issues, or records what a person chose. Printed values are never changed.
import { readDate } from "./dates";
import { PY_WHITESPACE_RUN, pyStrip } from "./money";
import { pyJsonDumps } from "./pyjson";
import type { Decision, ExtractionPayload, SourceDocument, ValidationResult } from "./run-state";
import type { Reference } from "./validation";

type Issue = ValidationResult["issues"][number];
type Order = ValidationResult["order"];
type Kind = NonNullable<SourceDocument["kind"]>;

export const CHECK_TITLES = {
  ambiguous_date: "Date can be read two ways",
  unclear_date: "Date is not a calendar date",
  source_conflict: "Email and attachment disagree",
  value_not_on_line: "Value is not on the line it was read for",
} as const;

const DATE_FIELDS: { field: string; label: string; from: "header" | "terms" }[] = [
  { field: "order_date", label: "Order date", from: "header" },
  { field: "requested_delivery_date", label: "Requested delivery date", from: "header" },
  { field: "ship_not_before", label: "Ship not before", from: "terms" },
  { field: "ship_no_later_than", label: "Ship no later than", from: "terms" },
];
const squash = (t: string) => pyStrip(t.replace(PY_WHITESPACE_RUN, " ")).toLowerCase();
const alnum = (t: string) => t.toUpperCase().replace(/[^A-Z0-9]/g, "");

function newIssue(code: keyof typeof CHECK_TITLES, key: string, message: string, o: {
  line?: number | null; printed?: string | null; reference?: string | string[] | null; evidence?: string | null;
  page?: number | null; actions: Issue["actions"]; field?: string; extra?: Partial<Issue>;
}): Issue {
  const line = o.line ?? null;
  return {
    key, code, title: CHECK_TITLES[code], message, line_index: line, printed_value: o.printed ?? null,
    reference_value: o.reference ?? null, reference_version: null, proposed_action: null, evidence: o.evidence ?? null,
    page: o.page ?? null, blocking: true, actions: [...o.actions, "reject_order"],
    fingerprint: pyJsonDumps([code, line, o.printed ?? null, o.field ?? null], true), status: "open", resolution: null,
    ...(o.field ? { field: o.field } : {}), ...(o.extra ?? {}),
  };
}

/** PO numbers an email's subject or text mentions, for comparison with the attachment (D62). */
export function mentionedPoNumbers(text: string): string[] {
  const out = new Set<string>();
  const re = /\b(?:p\.?o\.?|purchase\s+order)\s*(?:number|no\.?|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{3,})/gi;
  for (const m of text.matchAll(re)) if (/\d/.test(m[1])) out.add(m[1]);
  return [...out];
}
/** Same PO number when the digits and letters match, ignoring a leading "PO" and punctuation. */
const samePo = (a: string, b: string) => {
  const [x, y] = [alnum(a).replace(/^PO/, ""), alnum(b).replace(/^PO/, "")];
  return x === y || x.endsWith(y) || y.endsWith(x);
};

export interface CheckContext {
  payload: ExtractionPayload;
  pages: string[];
  kind: Kind;
  reference: Reference;
  decisions: Decision[];
  /** The email around an attachment: its subject and text. Absent for uploads and for the email text itself. */
  email?: { subject: string | null; bodyText: string | null } | null;
}

/** Adds the D63/D65 issues and choices to a validate() result and applies what a person chose. Mutates `out`. */
export function applyChecks(out: { order: Order; issues: Issue[] }, ctx: CheckContext): void {
  const { payload, pages, decisions } = ctx;
  const chosen = (key: string, action: Decision["action"]) => [...decisions].reverse().find((d) => d.issueKey === key && d.action === action);

  // ---- D63 dates: no US month-first assumption; unclear dates wait for a person ----
  const orderDay = payload.header.order_date.value ? readDate(payload.header.order_date.value) : null;
  const ref = orderDay?.kind === "date" ? orderDay.iso : null;
  for (const d of DATE_FIELDS) {
    const f = d.from === "header" ? payload.header[d.field as keyof ExtractionPayload["header"]]
      : payload.terms?.[d.field as keyof NonNullable<ExtractionPayload["terms"]>] as ExtractionPayload["header"]["po_number"] | undefined;
    if (!f || !f.value) continue;
    const reading = readDate(f.value, ref);
    if (reading.kind === "date") continue;
    const key = `${reading.kind === "ambiguous" ? "ambiguous_date" : "unclear_date"}:${d.field}`;
    out.issues.push(reading.kind === "ambiguous"
      ? newIssue("ambiguous_date", key, `${d.label} '${f.value}' can be ${reading.candidates.join(" or ")}. The date is never assumed.`,
        { printed: f.value, reference: reading.candidates, evidence: f.evidence, page: f.page, field: d.field,
          actions: ["choose_date", "request_customer_correction"], extra: { candidate_dates: reading.candidates } })
      : newIssue("unclear_date", key, `${d.label} '${f.value}' is not a calendar date. Enter the date the customer means.`,
        { printed: f.value, evidence: f.evidence, page: f.page, field: d.field, actions: ["choose_date", "request_customer_correction"] }));
    const pick = chosen(key, "choose_date");
    if (pick?.params.date) out.order.resolved_dates = { ...(out.order.resolved_dates ?? {}), [d.field]: pick.params.date };
  }

  // ---- D62 an email's subject or text names a different PO than its attachment ----
  const po = payload.header.po_number.value;
  if (ctx.email && po && ctx.kind !== "email_body") {
    const text = [ctx.email.subject, ctx.email.bodyText].filter(Boolean).join("\n");
    const other = mentionedPoNumbers(text).filter((m) => !samePo(m, po));
    if (other.length && !mentionedPoNumbers(text).some((m) => samePo(m, po))) {
      out.issues.push(newIssue("source_conflict", "source_conflict:po_number",
        `The email mentions PO ${other.join(", ")}; the attachment is PO ${po}. Confirm which order this is.`,
        { printed: po, reference: other, evidence: text.slice(0, 300), field: "po_number",
          actions: ["confirm_field", "request_customer_correction"] }));
    }
  }

  // ---- D65 a value found in the source but on another line than the one it was read for ----
  const rows = pages.flatMap((p, i) => p.split(/\r\n|[\n\r]/).map((t) => ({ page: i + 1, t: squash(t) })));
  payload.lines.forEach((line, idx) => {
    const id = [line.gtin, line.customer_item_code, line.supplier_sku].find((f) => f?.value && f.evidence_verified)?.value;
    if (!id) return;
    const at = rows.map((r, i) => (r.t.includes(squash(id)) ? i : -1)).filter((i) => i >= 0);
    if (!at.length) return;
    for (const name of ["quantity", "unit_price"] as const) {
      const f = line[name];
      if (!f?.value || !f.evidence_verified) continue;
      const near = at.some((i) => rows.slice(i, i + 3).some((r) => r.t.includes(squash(f.value!))));
      if (near) continue;
      out.issues.push(newIssue("value_not_on_line", `value_not_on_line:${idx}:${name}`,
        `Line ${line.source_line_id.value ?? idx + 1}: ${name.replace("_", " ")} '${f.value}' was found in the source, but not on the row for item ${id}.`,
        { line: idx, printed: f.value, evidence: f.evidence, page: f.page, field: name, actions: ["confirm_field"] }));
    }
  });

  // ---- D65 ship-to: offer the locations on file; a person's choice replaces the printed code on the order ----
  const ship = out.issues.find((i) => i.code === "unknown_ship_to");
  if (ship && out.order.customer_id) {
    const customer = ctx.reference.customers.find((c) => c.customer_id === out.order.customer_id);
    const candidates = (customer?.ship_tos ?? []).map((s) => s.ship_to_id);
    if (candidates.length) {
      ship.candidate_ship_tos = candidates;
      ship.actions = ["choose_ship_to", "request_customer_correction", ...ship.actions];
      const pick = chosen(ship.key, "choose_ship_to");
      if (pick?.params.ship_to_id && candidates.includes(pick.params.ship_to_id)) {
        out.order.printed_ship_to_id = out.order.ship_to_id;
        out.order.ship_to_id = pick.params.ship_to_id;
      }
    }
  }
  // A missing value can always go back to the customer.
  for (const i of out.issues) {
    if (i.code === "missing_line_value" && !i.actions.includes("request_customer_correction")) {
      i.actions = ["request_customer_correction", ...i.actions];
    }
  }
  // An email text or an EDI order has no printed total to compare; the PDF rule (D07) does not apply to them.
  if (ctx.kind !== "pdf" && !payload.header.total.value) {
    out.issues = out.issues.filter((i) => i.key !== "total_mismatch:total");
  }
}

/** The calendar date for an order field: what a person chose, else the printed date when it has one reading. */
export function orderDate(order: Order, field: string, printed: string | null | undefined, reference?: string | null): string | null {
  const chosen = order.resolved_dates?.[field];
  if (chosen) return chosen;
  if (!printed) return null;
  const r = readDate(printed, reference);
  return r.kind === "date" ? r.iso : null;
}
