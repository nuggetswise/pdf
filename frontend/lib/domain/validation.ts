// Deterministic matching and business-rule validation (checks against the ERP snapshot).
// AI may extract and explain; every comparison here is exact, uses Dec and the versioned reference data.
// Rounding rule: money is quantised to 2 places with ROUND_HALF_UP (DECISIONS.md D07).
import { Dec, dec, money, qty } from "./money";
import { pyJsonDumps } from "./pyjson";
import type { ExtractionPayload } from "./run-state";

// Policy table: every issue code blocks approval until a recorded decision resolves it.
// "actions" are the decisions a reviewer may record; reject_order is always available.
export const POLICY = {
  unknown_customer: { blocking: true, actions: [] },
  unknown_ship_to: { blocking: true, actions: [] },
  missing_po_number: { blocking: true, actions: [] },
  missing_currency: { blocking: true, actions: [] },
  currency_mismatch: { blocking: true, actions: [] },
  unverified_field: { blocking: true, actions: ["confirm_field"] },
  missing_line_value: { blocking: true, actions: [] },
  unknown_item: { blocking: true, actions: ["map_item"] },
  unknown_unit: { blocking: true, actions: [] },
  unit_conversion: { blocking: true, actions: ["confirm_conversion"] },
  moq_violation: { blocking: true, actions: ["one_off_exception", "request_customer_correction", "change_quantity"] },
  price_mismatch: { blocking: true, actions: ["accept_printed_price", "correct_price"] },
  outdated_identifier: { blocking: true, actions: ["apply_mapping"] },
  rule_needs_revalidation: { blocking: true, actions: ["apply_mapping"] },
  line_amount_mismatch: { blocking: true, actions: ["acknowledge_total_difference"] },
  total_mismatch: { blocking: true, actions: ["acknowledge_total_difference"] },
  possible_revision: { blocking: true, actions: ["accept_as_revision"] },
} as const satisfies Record<string, { blocking: boolean; actions: readonly string[] }>;

export type IssueCode = keyof typeof POLICY;

export const TITLES: Record<IssueCode, string> = {
  unknown_customer: "Customer not recognised",
  unknown_ship_to: "Ship-to not recognised for this customer",
  missing_po_number: "PO number missing",
  missing_currency: "Currency missing",
  currency_mismatch: "Currency differs from customer agreement",
  unverified_field: "Extracted value not found in the PDF",
  missing_line_value: "Line is missing a required value",
  unknown_item: "Item not recognised",
  unknown_unit: "Unit cannot be converted",
  unit_conversion: "Unit converted with supplied factor",
  moq_violation: "Below minimum order quantity",
  price_mismatch: "Price differs from agreed price",
  outdated_identifier: "Outdated GTIN",
  rule_needs_revalidation: "Approved correction needs revalidation",
  line_amount_mismatch: "Line amount does not add up",
  total_mismatch: "Printed total does not add up",
  possible_revision: "Same customer and PO already received",
};

// ---------- input shapes (snake_case, as the Python code and reference file use them) ----------

type Obj = Record<string, unknown>;
export interface Reference extends Obj {
  reference_version: string;
  policy_version: string;
  customers: Array<{ customer_id: string; name: string; currency: string; ship_tos: Array<{ ship_to_id: string }>;
    /** Session-added customer whose PO printed no ship-to (D46): ship-to is not checked until one is added. */
    ship_to_not_on_file?: boolean }>;
  /** Set when session additions are merged in (D46): memory rules stay tied to the base version. */
  base_reference_version?: string;
  /** Printed customer name or ID that a reviewer assigned to an existing customer (D46). */
  customer_name_aliases?: Array<{ printed: string; customer_id: string }>;
  products: Array<{ sku: string; description: string; gtin?: string | null; unit: string }>;
  obsolete_identifiers?: Array<{ identifier: string }>;
  proposed_identifier_mappings?: Array<{ obsolete_identifier: string; replacement_identifier: string; replacement_sku: string } & Obj>;
  customer_aliases?: Array<{ customer_id: string; customer_item_code: string; sku: string }>;
  unit_conversions?: Array<{ sku: string; from_unit: string; to_unit: string; factor: string; direction: string; approved?: boolean }>;
  reference_prices?: Array<{ customer_id: string; sku: string; unit: string; currency: string; price: string }>;
  moq_rules?: Array<{ customer_id: string; sku: string; minimum: string; unit: string; version: string }>;
}
export interface RuleInput {
  id: number; customer_id: string; obsolete_identifier: string; replacement_identifier: string;
  replacement_sku: string; reference_version?: string | null; state: string;
  activated_by?: string | null; activated_at?: string | null;
}
export type Overrides = Record<string, { sku?: string; replacement_sku?: string; text?: string; quantity?: string | null; unit_price?: string | null }>;
export interface OtherOrder { document_id: number; customer_id: string | null; po_number: string | null }

type Payload = Pick<ExtractionPayload, "header" | "lines">;
type FieldLike = { value?: string | null; evidence?: string | null; page?: number | null; evidence_verified?: boolean } | null | undefined;

// ---------- helpers ----------

/** Python f-string rendering of a value that may be None. */
const s = (v: string | null | undefined): string => (v === null || v === undefined ? "None" : v);

function person(actor: string | null | undefined): string {
  const a = actor || "unknown";
  const i = a.indexOf(":");
  const role = i < 0 ? a : a.slice(0, i);
  const name = i < 0 ? "" : a.slice(i + 1);
  return name ? `${name} (${role})` : role;
}

const v = (field: FieldLike): string | null => (field && typeof field === "object" ? field.value ?? null : null);

type Printed = string | string[] | null;
interface IssueOpts {
  line?: number | null; printed?: Printed; reference?: Printed; proposed?: string | null; evidence?: string | null;
  page?: number | null; extra?: Obj; refVersion?: string | null; key?: string;
}

function issue(code: IssueCode, message: string, o: IssueOpts = {}): Obj {
  const line = o.line ?? null;
  const printed = o.printed ?? null;
  const reference = o.reference ?? null;
  const out: Obj = {
    key: `${code}:${line === null ? "H" : line}`, code, title: TITLES[code], message, line_index: line,
    printed_value: printed, reference_value: reference, reference_version: o.refVersion ?? null,
    proposed_action: o.proposed ?? null, evidence: o.evidence ?? null, page: o.page ?? null,
    blocking: POLICY[code].blocking, actions: [...POLICY[code].actions, "reject_order"],
    fingerprint: pyJsonDumps([code, line, printed, reference], true), ...(o.extra ?? {}),
  };
  if (o.key !== undefined) out.key = o.key;
  return out;
}

function lastWins<T, K>(items: T[], key: (t: T) => K | null | undefined | "" | false): Map<K, T> {
  const m = new Map<K, T>();
  for (const it of items) { const k = key(it); if (k) m.set(k as K, it); }
  return m;
}

// ---------- validate ----------

/** Returns {"order": canonical order, "issues": [...]}.
 *  overrides: decisions already recorded that change matching (keyed by issue key), e.g. map_item -> sku,
 *  apply_mapping -> replacement. Printed values are never changed by an override. */
export function validate(payload: Payload, ref: Reference, activeRules: RuleInput[] | null = null,
  overrides: Overrides | null = null, otherOrders: OtherOrder[] | null = null): { order: Obj; issues: Obj[] } {
  const ov = overrides ?? {};
  const rules = activeRules ?? [];
  const rv = ref.reference_version;
  const header = payload.header as Record<string, FieldLike>;
  const issues: Obj[] = [];

  for (const [name, field] of Object.entries(header)) {
    if (field && field.value !== null && field.value !== undefined && !field.evidence_verified) {
      issues.push(issue("unverified_field", `${name} value '${field.value}' was not found in the PDF.`, {
        printed: field.value, evidence: field.evidence ?? null, page: field.page ?? null, extra: { field: name },
        key: `unverified_field:${name}`,
      }));
    }
  }

  const customerId = v(header.customer_id);
  const customerName = v(header.customer_name);
  let customer = ref.customers.find((c) => customerId && c.customer_id === customerId) ?? null;
  if (customer === null && !customerId && customerName) {
    customer = ref.customers.find((c) => c.name.toLowerCase() === customerName.toLowerCase()) ?? null;
  }
  const printedCustomer = customerId || customerName;
  if (customer === null && printedCustomer && ref.customer_name_aliases?.length) {
    const hit = ref.customer_name_aliases.find((a) => a.printed.toLowerCase() === printedCustomer.toLowerCase());
    customer = hit ? ref.customers.find((c) => c.customer_id === hit.customer_id) ?? null : null;
  }
  if (customer === null) {
    issues.push(issue("unknown_customer",
      `Customer '${customerId || customerName || "missing"}' is not in reference data. ` +
      "The order is never assigned to another customer automatically.",
      { printed: customerId || customerName || null, refVersion: rv }));
  }
  const custId = customer ? customer.customer_id : null;

  const shipTo = v(header.ship_to_id);
  const shipToChecked = !(customer?.ship_to_not_on_file && customer.ship_tos.length === 0);
  if (customer && shipToChecked && !customer.ship_tos.some((st) => st.ship_to_id === shipTo)) {
    issues.push(issue("unknown_ship_to", `Ship-to '${s(shipTo)}' is not on file for ${s(custId)}.`,
      { printed: shipTo, reference: customer.ship_tos.map((st) => st.ship_to_id), refVersion: rv }));
  }
  const po = v(header.po_number);
  if (!po) issues.push(issue("missing_po_number", "No PO number was found in the PDF."));
  const currency = v(header.currency);
  if (!currency) {
    issues.push(issue("missing_currency", "Currency is unknown. It is never assumed."));
  } else if (customer && currency !== customer.currency) {
    issues.push(issue("currency_mismatch", `Printed currency ${currency}; customer agreement is ${customer.currency}.`,
      { printed: currency, reference: customer.currency, refVersion: rv }));
  }

  const products = lastWins(ref.products, (p) => p.sku);
  const byGtin = lastWins(ref.products, (p) => p.gtin);
  const obsolete = lastWins(ref.obsolete_identifiers ?? [], (o) => o.identifier);
  const proposals = lastWins(ref.proposed_identifier_mappings ?? [], (m) => m.obsolete_identifier);

  const linesOut: Obj[] = [];
  let computedSubtotal = Dec.of("0");
  payload.lines.forEach((lineIn, idx) => {
    const line = lineIn as Record<string, FieldLike>;
    const label = v(line.source_line_id) || String(idx + 1);
    const evidence = line.description?.evidence || line.quantity?.evidence || null;
    const page = line.quantity?.page ?? null;
    const gtin = v(line.gtin);
    const alias = v(line.customer_item_code);
    const q = dec(v(line.quantity));
    const unit = v(line.unit);
    const price = dec(v(line.unit_price));
    const amount = dec(v(line.line_amount));
    const out: Obj = {
      line_index: idx, source_line_id: label, printed_gtin: gtin, customer_item_code: alias,
      description: v(line.description), original_quantity: v(line.quantity), original_unit: unit,
      printed_unit_price: v(line.unit_price), printed_line_amount: v(line.line_amount), sku: null, gtin: null,
      quantity: null, unit: null, unit_price: null, line_amount: null, resolved_by: null, evidence, page,
    };
    for (const name of ["quantity", "unit", "unit_price"] as const) {
      if (!v(line[name]) || (name !== "unit" && dec(v(line[name])) === null)) {
        issues.push(issue("missing_line_value", `Line ${label}: ${name.replace(/_/g, " ")} is missing or unreadable.`,
          { line: idx, evidence, page, extra: { field: name }, key: `missing_line_value:${idx}:${name}` }));
      }
    }
    for (const [name, field] of Object.entries(line)) {
      if (field && field.value !== null && field.value !== undefined && !field.evidence_verified) {
        issues.push(issue("unverified_field", `Line ${label}: ${name} value '${field.value}' was not found in the PDF.`,
          { line: idx, printed: field.value, page, extra: { field: name }, key: `unverified_field:${idx}:${name}` }));
      }
    }

    // ---- item matching: GTIN, then customer alias, then outdated identifier ----
    let product: Reference["products"][number] | null = null;
    const key = `outdated_identifier:${idx}`;
    if (gtin && byGtin.has(gtin)) {
      product = byGtin.get(gtin)!;
    } else if (alias && custId) {
      const hit = (ref.customer_aliases ?? []).find((a) => a.customer_id === custId && a.customer_item_code === alias);
      product = hit ? products.get(hit.sku) ?? null : null;
    }
    // D59: many retailer POs print the supplier's own item number instead of a GTIN.
    const supplierSku = v((line as { supplier_sku?: typeof line.gtin }).supplier_sku ?? null);
    if (supplierSku) out.supplier_sku = supplierSku;
    if (product === null && supplierSku && products.has(supplierSku)) product = products.get(supplierSku)!;
    if (product === null && gtin && obsolete.has(gtin)) {
      const rule = rules.find((r) => r.obsolete_identifier === gtin && r.customer_id === custId && r.state === "active");
      if (rule && rule.reference_version === (ref.base_reference_version ?? rv)) {
        product = products.get(rule.replacement_sku) ?? null;
        out.resolved_by = {
          type: "memory_rule", rule_id: rule.id, approved_by: rule.activated_by ?? null,
          activated_at: rule.activated_at ?? null,
          text: `Resolved by memory rule #${rule.id} (${gtin} -> ${rule.replacement_identifier}), activated by ` +
            person(rule.activated_by),
        };
      } else {
        const proposal = proposals.get(gtin) ?? null;
        if (key in ov) { // issue stays listed so the card shows who resolved it
          product = products.get(ov[key].replacement_sku as string) ?? null;
          out.resolved_by = { type: "review_decision", text: ov[key].text };
        }
        const code = rule ? "rule_needs_revalidation" : "outdated_identifier";
        let msg = `Line ${label}: ${gtin} is a retired identifier. ` + (proposal
          ? `Supplier notice proposes ${proposal.replacement_identifier}; it needs a reviewer decision before use.`
          : "No approved replacement exists.");
        if (rule) {
          msg = `Line ${label}: memory rule #${rule.id} was approved against reference ` +
            `${s(rule.reference_version)}; current reference is ${rv}. Revalidate before use.`;
        }
        issues.push(issue(code, msg, {
          line: idx, printed: gtin, reference: proposal ? proposal.replacement_identifier : null,
          proposed: proposal ? `Apply mapping ${gtin} -> ${proposal.replacement_identifier} for ${s(custId)}` : null,
          evidence, page, refVersion: rv, extra: { proposal }, key,
        }));
      }
    } else if (product === null) {
      const mkey = `unknown_item:${idx}`;
      if (mkey in ov) {
        product = products.get(ov[mkey].sku as string) ?? null;
        out.resolved_by = { type: "review_decision", text: ov[mkey].text };
      }
      issues.push(issue("unknown_item", `Line ${label}: '${alias || gtin || supplierSku || "no identifier"}' does not ` +
        `match any product for ${custId || "this customer"}.`, {
        line: idx, printed: alias || gtin || supplierSku || null, evidence, page, refVersion: rv,
        extra: { candidate_skus: ref.products.map((p) => p.sku) },
      }));
    }
    if (product === null) {
      linesOut.push(out);
      if (amount !== null) computedSubtotal = computedSubtotal.add(amount);
      return;
    }
    out.sku = product.sku;
    out.gtin = product.gtin ?? null;
    out.description_reference = product.description;

    // ---- unit conversion (only with a supplied approved factor) ----
    let dq = q;
    let dp = price;
    let dunit = unit;
    // Units printed in another case ("Case" for CASE) are the same unit.
    if (unit && unit !== product.unit && unit.toLowerCase() === product.unit.toLowerCase()) dunit = product.unit;
    if (q !== null && unit && unit.toLowerCase() !== product.unit.toLowerCase()) {
      const p = product;
      const conv = (ref.unit_conversions ?? []).find((c) => c.sku === p.sku && c.from_unit === unit
        && c.to_unit === p.unit && c.approved);
      if (conv === undefined) {
        issues.push(issue("unknown_unit", `Line ${label}: no approved conversion from ${unit} to ` +
          `${product.unit}. Pack size is never guessed.`, {
          line: idx, printed: unit, reference: product.unit, evidence, page, refVersion: rv,
        }));
        dq = null;
      } else {
        const factor = Dec.of(conv.factor);
        const divide = conv.direction === "divide";
        dq = divide ? q.div(factor) : q.mul(factor);
        dp = price !== null ? (divide ? price.mul(factor) : price.div(factor)) : null;
        dunit = product.unit;
        issues.push(issue("unit_conversion", `Line ${label}: ${qty(q)} ${unit} = ${qty(dq)} ${dunit} using ` +
          `supplied factor ${conv.factor}; unit price ${dp && !dp.isZero() ? money(dp) : "?"} per ${dunit}.`, {
          line: idx, printed: `${qty(q)} ${unit}`, reference: `${qty(dq)} ${dunit}`,
          proposed: "Confirm supplied conversion", evidence, page, refVersion: rv,
        }));
      }
    }
    const edit = ov[`edit:${idx}`] ?? {};
    if (edit.quantity !== null && edit.quantity !== undefined) {
      dq = dec(edit.quantity);
      out.edited = true;
    }
    if (edit.unit_price !== null && edit.unit_price !== undefined) {
      dp = dec(edit.unit_price);
      out.edited = true;
    }
    out.quantity = dq !== null ? qty(dq) : null;
    out.unit = dq !== null ? dunit : null;
    out.unit_price = dp !== null ? money(dp) : null;
    if (dq !== null && dp !== null) out.line_amount = money(dq.mul(dp));

    // ---- MOQ (in the rule's unit; quantity is never raised) ----
    const sku = product.sku;
    const moq = (ref.moq_rules ?? []).find((m) => m.customer_id === custId && m.sku === sku);
    if (moq && dq !== null && dunit === moq.unit && dq.lt(Dec.of(moq.minimum))) {
      issues.push(issue("moq_violation", `Line ${label}: ${qty(dq)} ${s(dunit)} is below the minimum of ` +
        `${moq.minimum} ${moq.unit}. The quantity is not changed automatically.`, {
        line: idx, printed: `${qty(dq)} ${s(dunit)}`, reference: `${moq.minimum} ${moq.unit}`,
        proposed: "Ask the customer to correct, or record an authorised one-off exception",
        evidence, page, refVersion: moq.version,
      }));
    }
    // ---- price (printed and reference both preserved) ----
    const rp = (ref.reference_prices ?? []).find((p) => p.customer_id === custId && p.sku === sku
      && p.unit === dunit && p.currency === currency);
    // Python's bare quantize() uses the context rounding, ROUND_HALF_EVEN.
    if (rp && dp !== null && !dp.quantize(-2, "half_even").eq(Dec.of(rp.price))) {
      issues.push(issue("price_mismatch", `Line ${label}: printed ${money(dp)} ${s(currency)} per ${s(dunit)}; ` +
        `agreed price is ${rp.price}.`, {
        line: idx, printed: money(dp), reference: rp.price,
        proposed: "Accept printed price with a reason, or correct it", evidence, page, refVersion: rv,
      }));
    }
    // ---- printed line amount ----
    if (q !== null && price !== null && amount !== null && money(q.mul(price)) !== money(amount)) {
      issues.push(issue("line_amount_mismatch", `Line ${label}: ${qty(q)} x ${money(price)} = ` +
        `${money(q.mul(price))}, but ${money(amount)} is printed.`, {
        line: idx, printed: money(amount), reference: money(q.mul(price)), evidence, page,
      }));
    }
    const lineAmount = out.line_amount as string | null;
    computedSubtotal = computedSubtotal.add(lineAmount ? Dec.of(lineAmount)
      : amount && !amount.isZero() ? amount : Dec.of("0"));
    linesOut.push(out);
  });

  const printed = {
    subtotal: v(header.subtotal), tax: v(header.tax), shipping: v(header.shipping), total: v(header.total),
  };
  const taxD = dec(printed.tax);
  const shipD = dec(printed.shipping);
  const tax = taxD && !taxD.isZero() ? taxD : Dec.of("0");
  const shipping = shipD && !shipD.isZero() ? shipD : Dec.of("0");
  const computedTotal = computedSubtotal.add(tax).add(shipping);
  const totals = {
    printed_subtotal: printed.subtotal, printed_tax: printed.tax, printed_shipping: printed.shipping,
    printed_total: printed.total, computed_subtotal: money(computedSubtotal), computed_total: money(computedTotal),
    rounding: "ROUND_HALF_UP to 0.01",
  };
  const subD = dec(printed.subtotal);
  if (subD !== null && money(subD) !== money(computedSubtotal)) {
    issues.push(issue("total_mismatch", `Lines add up to ${money(computedSubtotal)}; printed subtotal is ` +
      `${printed.subtotal}. The printed value is kept.`, {
      printed: printed.subtotal, reference: money(computedSubtotal), key: "total_mismatch:subtotal",
    }));
  }
  const totD = dec(printed.total);
  if (totD === null) {
    issues.push(issue("total_mismatch", "No printed total was found.",
      { reference: money(computedTotal), key: "total_mismatch:total" }));
  } else if (money(totD) !== money(computedTotal)) {
    issues.push(issue("total_mismatch", `Computed total ${money(computedTotal)}; printed total is ` +
      `${printed.total}. The printed value is kept.`, {
      printed: printed.total, reference: money(computedTotal), key: "total_mismatch:total",
    }));
  }

  for (const other of otherOrders ?? []) {
    if (custId && po && other.customer_id === custId && other.po_number === po) {
      issues.push(issue("possible_revision", `PO ${po} for ${custId} was already received as order ` +
        `#${other.document_id} with different content. Held as a possible revision.`, {
        printed: po, reference: `order #${other.document_id}`, extra: { other_document_id: other.document_id },
      }));
      break;
    }
  }

  const order = {
    customer_id: custId, customer_name: customer ? customer.name : customerName,
    po_number: po, currency, ship_to_id: shipTo, order_date: v(header.order_date),
    requested_delivery_date: v(header.requested_delivery_date),
    lines: linesOut, totals, reference_version: rv, policy_version: ref.policy_version,
  };
  return { order, issues };
}
