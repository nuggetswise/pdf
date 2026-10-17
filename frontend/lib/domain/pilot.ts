// D53: pilot measurement. One row per order, from what the run already records, so a supplier pilot can show
// time from PDF to ERP, how much a person changed, and what the agent caught. Exported as CSV in the browser.
// Durations are whole calendar time between recorded events, not working time; every number is derived, none typed in.
// No saving is claimed: chargeback_exposure_assumed comes from the administrator's manual-route assumptions (D49),
// and person working time is not measured (minutes_waiting_for_person is elapsed time, not effort). D67.
import { manualRoute } from "./manual-route";
import { Dec } from "./money";
import type { RunState } from "./run-state";
import { channelOf, effectivePolicy } from "./workflow";

export const PILOT_COLUMNS = [
  "po_number", "customer_id", "received_at", "approved_by", "in_erp_at", "minutes_received_to_erp",
  "first_asn_at", "minutes_erp_to_first_asn", "asn_count", "first_invoice_at", "values_extracted",
  "values_edited_by_person", "issues_caught", "lines_fixed_by_memory", "decisions_by_person",
  "manual_route_fields", "manual_route_minutes", "chargeback_exposure_assumed", "currency",
  // D67: route, supervision, timing split, exceptions, attempts, confirmed outcome and Command Center findings.
  "channel", "supervision_mode", "minutes_received_to_checked", "minutes_waiting_for_person", "exception_reasons",
  "erp_attempts", "confirmed_outcome", "findings", "finding_first_detected_at", "finding_owners", "finding_actions",
  "findings_verified", "finding_last_verified_at", "findings_pending",
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
      chargeback_exposure_assumed: m?.chargebackExposure ?? "", currency: m?.currency ?? "",
      ...timingAndFindings(s, o.documentId, received),
    };
  });
}

function timingAndFindings(s: RunState, docId: number, received: string | null) {
  const o = s.orders.find((x) => x.documentId === docId)!;
  const events = s.audit.filter((a) => a.entityType === "document" && a.entityId === docId).sort((a, b) => a.id - b.id);
  const checked = events.find((a) => a.event === "needs_review" || a.event === "ready_for_approval")?.createdAt ?? null;
  const waitStart = events.find((a) => a.event === "needs_review")?.createdAt ?? null;
  const approved = s.approvals.filter((a) => a.documentId === docId).sort((a, b) => a.id - b.id).at(-1)?.createdAt ?? null;
  const end = approved ?? (["rejected"].includes(o.reviewState) ? events.findLast((a) => a.event === "rejected")?.createdAt ?? null : null);
  const findings = (s.commandCenter?.findings ?? []).filter((f) => f.documentId === docId);
  const verified = findings.filter((f) => f.verification.status === "verified");
  const outcome = o.deliveryState === "erp_created" && o.erpOrderId ? `in ERP as ${o.erpOrderId}`
    : o.reviewState === "rejected" ? "rejected" : o.reviewState === "on_hold" ? "on hold"
      : ["failed", "unknown"].includes(o.deliveryState) ? `ERP ${o.deliveryState}, not confirmed` : "not confirmed";
  return {
    channel: channelOf(s, docId), supervision_mode: effectivePolicy(s, docId).mode,
    minutes_received_to_checked: minutesBetween(received, checked),
    minutes_waiting_for_person: waitStart && end ? minutesBetween(waitStart, end) : "",
    exception_reasons: [...new Set(o.validation.issues.map((i) => i.code))].join(" "),
    erp_attempts: String(s.deliveries.filter((d) => d.documentId === docId).length),
    confirmed_outcome: outcome,
    findings: findings.map((f) => f.type).join(" "),
    finding_first_detected_at: findings.map((f) => f.detectedAt).sort()[0] ?? "",
    finding_owners: findings.map((f) => f.owner?.actor ?? "unassigned").join(" "),
    finding_actions: findings.map((f) => f.actionStatus).join(" "),
    findings_verified: String(verified.length),
    finding_last_verified_at: verified.map((f) => f.verification.at ?? "").sort().at(-1) ?? "",
    findings_pending: String(findings.length - verified.length),
  };
}

/** RFC 4180 CSV. A cell starting with = + - @ gets a leading apostrophe so a spreadsheet will not run it as a formula. */
export function toCsv(rows: PilotRow[]): string {
  const cell = (v: string) => {
    const safe = /^[=+\-@\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v) ? `'${v}` : v;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [PILOT_COLUMNS.join(","), ...rows.map((r) => PILOT_COLUMNS.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
}
