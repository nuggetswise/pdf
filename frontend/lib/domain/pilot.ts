// D53: pilot measurement. One row per order, from what the run already records, so a supplier pilot can show
// time from PDF to ERP, how much a person changed, and what the agent caught. Exported as CSV in the browser.
// Durations are whole calendar time between recorded events, not working time; every number is derived, none typed in.
import { manualRoute } from "./manual-route";
import { Dec } from "./money";
import type { RunState } from "./run-state";

export const PILOT_COLUMNS = [
  "po_number", "customer_id", "received_at", "approved_by", "in_erp_at", "minutes_received_to_erp",
  "first_asn_at", "minutes_erp_to_first_asn", "asn_count", "first_invoice_at", "values_extracted",
  "values_edited_by_person", "issues_caught", "lines_fixed_by_memory", "decisions_by_person",
  "manual_route_fields", "manual_route_minutes", "chargeback_exposure_avoided", "currency",
] as const;
export type PilotRow = Record<(typeof PILOT_COLUMNS)[number], string>;

/** The extracted field values (each field's `value`, not its evidence or notes) as path -> value. */
function leaves(v: unknown, path = "", out = new Map<string, string>()): Map<string, string> {
  if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if (!path && (k === "extractor" || k === "applied_decisions" || k === "schema_version")) continue;
      leaves(x, path ? `${path}.${k}` : k, out);
    }
  } else if (path.endsWith(".value")) out.set(path, v === null || v === undefined ? "" : String(v));
  return out;
}

const minutesBetween = (a: string | null, b: string | null) =>
  a && b ? Dec.of(String(Date.parse(b) - Date.parse(a))).div(Dec.of("60000")).quantize(-1, "half_up").toString() : "";

export function pilotRows(s: RunState): PilotRow[] {
  return s.orders.map((o) => {
    const doc = s.documents.find((d) => d.id === o.documentId);
    const versions = s.versions.filter((v) => v.documentId === o.documentId).sort((a, b) => a.version - b.version);
    const first = versions[0] ? leaves(versions[0].payload) : new Map<string, string>();
    const last = versions.at(-1) ? leaves(versions.at(-1)!.payload) : first;
    let changed = 0;
    for (const k of new Set([...first.keys(), ...last.keys()])) if ((first.get(k) ?? "") !== (last.get(k) ?? "")) changed += 1;
    const approval = s.approvals.filter((a) => a.documentId === o.documentId && !a.invalidatedAt).at(-1);
    const erp = o.erpOrderId ? s.erpOrders.find((e) => e.erpOrderId === o.erpOrderId) ?? null : null;
    const asns = (s.portal?.asns ?? []).filter((a) => a.documentId === o.documentId).sort((a, b) => a.id - b.id);
    const inv = (s.portal?.invoices ?? []).filter((i) => i.documentId === o.documentId).sort((a, b) => a.id - b.id)[0];
    const m = manualRoute(s, o.documentId);
    const received = doc?.createdAt ?? null;
    const inErp = erp?.createdAt ?? null;
    return {
      po_number: o.poNumber ?? "", customer_id: o.customerId ?? "", received_at: received ?? "",
      approved_by: approval ? (approval.kind === "system" ? "policy (no human touch)" : approval.actor) : "",
      in_erp_at: inErp ?? "", minutes_received_to_erp: minutesBetween(received, inErp),
      first_asn_at: asns[0]?.createdAt ?? "", minutes_erp_to_first_asn: minutesBetween(inErp, asns[0]?.createdAt ?? null),
      asn_count: String(asns.length), first_invoice_at: inv?.createdAt ?? "",
      values_extracted: String([...first.values()].filter((v) => v !== "").length),
      values_edited_by_person: String(changed),
      issues_caught: String(o.validation.issues.length),
      lines_fixed_by_memory: String(o.validation.order.lines.filter((l) => l.resolved_by?.type === "memory_rule").length),
      decisions_by_person: String(s.decisions.filter((d) => d.documentId === o.documentId && d.role !== "viewer").length),
      manual_route_fields: m ? String(m.fields.total) : "", manual_route_minutes: m?.minutes ?? "",
      chargeback_exposure_avoided: m?.chargebackExposure ?? "", currency: m?.currency ?? "",
    };
  });
}

/** RFC 4180 CSV. A cell starting with = + - @ gets a leading apostrophe so a spreadsheet will not run it as a formula. */
export function toCsv(rows: PilotRow[]): string {
  const cell = (v: string) => {
    const safe = /^[=+\-@\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v) ? `'${v}` : v;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [PILOT_COLUMNS.join(","), ...rows.map((r) => PILOT_COLUMNS.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
}
