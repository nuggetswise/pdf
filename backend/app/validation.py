"""Deterministic matching and business-rule validation (Slice 3).

AI may extract and explain; every comparison here is exact, uses Decimal and the versioned reference data.
Rounding rule: money is quantised to 2 places with ROUND_HALF_UP (DECISIONS.md D07).
"""
from __future__ import annotations

import json
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from .config import BACKEND_DIR

REFERENCE_FILE = BACKEND_DIR / "runtime_data" / "reference-data.v1.json"
CENT = Decimal("0.01")

# Policy table: every issue code blocks approval until a recorded decision resolves it.
# "actions" are the decisions a reviewer may record; reject_order is always available.
POLICY: dict[str, dict[str, Any]] = {
    "unknown_customer": {"blocking": True, "actions": []},
    "unknown_ship_to": {"blocking": True, "actions": []},
    "missing_po_number": {"blocking": True, "actions": []},
    "missing_currency": {"blocking": True, "actions": []},
    "currency_mismatch": {"blocking": True, "actions": []},
    "unverified_field": {"blocking": True, "actions": ["confirm_field"]},
    "missing_line_value": {"blocking": True, "actions": []},
    "unknown_item": {"blocking": True, "actions": ["map_item"]},
    "unknown_unit": {"blocking": True, "actions": []},
    "unit_conversion": {"blocking": True, "actions": ["confirm_conversion"]},
    "moq_violation": {"blocking": True,
                      "actions": ["one_off_exception", "request_customer_correction", "change_quantity"]},
    "price_mismatch": {"blocking": True, "actions": ["accept_printed_price", "correct_price"]},
    "outdated_identifier": {"blocking": True, "actions": ["apply_mapping"]},
    "rule_needs_revalidation": {"blocking": True, "actions": ["apply_mapping"]},
    "line_amount_mismatch": {"blocking": True, "actions": ["acknowledge_total_difference"]},
    "total_mismatch": {"blocking": True, "actions": ["acknowledge_total_difference"]},
    "possible_revision": {"blocking": True, "actions": ["accept_as_revision"]},
}

TITLES = {
    "unknown_customer": "Customer not recognised",
    "unknown_ship_to": "Ship-to not recognised for this customer",
    "missing_po_number": "PO number missing",
    "missing_currency": "Currency missing",
    "currency_mismatch": "Currency differs from customer agreement",
    "unverified_field": "Extracted value not found in the PDF",
    "missing_line_value": "Line is missing a required value",
    "unknown_item": "Item not recognised",
    "unknown_unit": "Unit cannot be converted",
    "unit_conversion": "Unit converted with supplied factor",
    "moq_violation": "Below minimum order quantity",
    "price_mismatch": "Price differs from agreed price",
    "outdated_identifier": "Outdated GTIN",
    "rule_needs_revalidation": "Memory rule needs revalidation",
    "line_amount_mismatch": "Line amount does not add up",
    "total_mismatch": "Printed total does not add up",
    "possible_revision": "Same customer and PO already received",
}


def load_reference(path: Path = REFERENCE_FILE) -> dict[str, Any]:
    return json.loads(path.read_text())


def dec(value: Any) -> Decimal | None:
    if value in (None, ""):
        return None
    try:
        return Decimal(str(value).replace(",", "").strip())
    except InvalidOperation:
        return None


def money(value: Decimal) -> str:
    return str(value.quantize(CENT, rounding=ROUND_HALF_UP))


def qty(value: Decimal) -> str:
    return format(value.normalize(), "f") if value == value.to_integral() else str(value)


def _person(actor: str | None) -> str:
    role, _, name = (actor or "unknown").partition(":")
    return f"{name} ({role})" if name else role


def _v(field: Any) -> str | None:
    return field.get("value") if isinstance(field, dict) else field


def _issue(code: str, message: str, line: int | None = None, printed: Any = None, reference: Any = None,
           proposed: str | None = None, evidence: str | None = None, page: int | None = None,
           extra: dict | None = None, ref_version: str | None = None) -> dict[str, Any]:
    key = f"{code}:{'H' if line is None else line}"
    return {
        "key": key, "code": code, "title": TITLES[code], "message": message, "line_index": line,
        "printed_value": printed, "reference_value": reference, "reference_version": ref_version,
        "proposed_action": proposed, "evidence": evidence, "page": page,
        "blocking": POLICY[code]["blocking"], "actions": POLICY[code]["actions"] + ["reject_order"],
        "fingerprint": json.dumps([code, line, printed, reference], sort_keys=True), **(extra or {}),
    }


def validate(payload: dict[str, Any], ref: dict[str, Any], active_rules: list[dict[str, Any]] | None = None,
             overrides: dict[str, Any] | None = None, other_orders: list[dict[str, Any]] | None = None
             ) -> dict[str, Any]:
    """Return {"order": canonical order, "issues": [...]}.

    overrides: decisions already recorded that change matching (keyed by issue key), e.g. map_item -> sku,
    apply_mapping -> replacement. Printed values are never changed by an override.
    """
    overrides = overrides or {}
    active_rules = active_rules or []
    rv = ref["reference_version"]
    header = payload["header"]
    issues: list[dict[str, Any]] = []

    for name, field in header.items():
        if field.get("value") is not None and not field.get("evidence_verified"):
            issues.append(_issue("unverified_field", f"{name} value '{field['value']}' was not found in the PDF.",
                                 printed=field["value"], evidence=field.get("evidence"), page=field.get("page"),
                                 extra={"field": name}) | {"key": f"unverified_field:{name}"})

    customer_id, customer_name = _v(header.get("customer_id")), _v(header.get("customer_name"))
    customer = next((c for c in ref["customers"] if customer_id and c["customer_id"] == customer_id), None)
    if customer is None and not customer_id and customer_name:
        customer = next((c for c in ref["customers"] if c["name"].lower() == customer_name.lower()), None)
    if customer is None:
        issues.append(_issue("unknown_customer",
                             f"Customer '{customer_id or customer_name or 'missing'}' is not in reference data. "
                             "The order is never assigned to another customer automatically.",
                             printed=customer_id or customer_name, ref_version=rv))
    cust_id = customer["customer_id"] if customer else None

    ship_to = _v(header.get("ship_to_id"))
    if customer and not any(s["ship_to_id"] == ship_to for s in customer["ship_tos"]):
        issues.append(_issue("unknown_ship_to", f"Ship-to '{ship_to}' is not on file for {cust_id}.",
                             printed=ship_to, reference=[s["ship_to_id"] for s in customer["ship_tos"]],
                             ref_version=rv))
    po = _v(header.get("po_number"))
    if not po:
        issues.append(_issue("missing_po_number", "No PO number was found in the PDF."))
    currency = _v(header.get("currency"))
    if not currency:
        issues.append(_issue("missing_currency", "Currency is unknown. It is never assumed."))
    elif customer and currency != customer["currency"]:
        issues.append(_issue("currency_mismatch", f"Printed currency {currency}; customer agreement is "
                             f"{customer['currency']}.", printed=currency, reference=customer["currency"],
                             ref_version=rv))

    products = {p["sku"]: p for p in ref["products"]}
    by_gtin = {p["gtin"]: p for p in ref["products"] if p.get("gtin")}
    obsolete = {o["identifier"]: o for o in ref.get("obsolete_identifiers", [])}
    proposals = {m["obsolete_identifier"]: m for m in ref.get("proposed_identifier_mappings", [])}

    lines_out: list[dict[str, Any]] = []
    computed_subtotal = Decimal("0")
    for idx, line in enumerate(payload["lines"]):
        label = _v(line.get("source_line_id")) or str(idx + 1)
        evidence = (line.get("description") or {}).get("evidence") or (line.get("quantity") or {}).get("evidence")
        page = (line.get("quantity") or {}).get("page")
        gtin, alias = _v(line.get("gtin")), _v(line.get("customer_item_code"))
        q, unit = dec(_v(line.get("quantity"))), _v(line.get("unit"))
        price, amount = dec(_v(line.get("unit_price"))), dec(_v(line.get("line_amount")))
        out: dict[str, Any] = {
            "line_index": idx, "source_line_id": label, "printed_gtin": gtin, "customer_item_code": alias,
            "description": _v(line.get("description")), "original_quantity": _v(line.get("quantity")),
            "original_unit": unit, "printed_unit_price": _v(line.get("unit_price")),
            "printed_line_amount": _v(line.get("line_amount")), "sku": None, "gtin": None, "quantity": None,
            "unit": None, "unit_price": None, "line_amount": None, "resolved_by": None, "evidence": evidence,
            "page": page,
        }
        for name in ("quantity", "unit", "unit_price"):
            if not _v(line.get(name)) or (name != "unit" and dec(_v(line.get(name))) is None):
                issues.append(_issue("missing_line_value", f"Line {label}: {name.replace('_', ' ')} is missing "
                                     "or unreadable.", line=idx, evidence=evidence, page=page,
                                     extra={"field": name}) | {"key": f"missing_line_value:{idx}:{name}"})
        for name, field in line.items():
            if field.get("value") is not None and not field.get("evidence_verified"):
                issues.append(_issue("unverified_field", f"Line {label}: {name} value '{field['value']}' was not "
                                     "found in the PDF.", line=idx, printed=field["value"], page=page,
                                     extra={"field": name}) | {"key": f"unverified_field:{idx}:{name}"})

        # ---- item matching: GTIN, then customer alias, then outdated identifier ----
        product = None
        key = f"outdated_identifier:{idx}"
        if gtin and gtin in by_gtin:
            product = by_gtin[gtin]
        elif alias and cust_id:
            hit = next((a for a in ref.get("customer_aliases", [])
                        if a["customer_id"] == cust_id and a["customer_item_code"] == alias), None)
            product = products.get(hit["sku"]) if hit else None
        if product is None and gtin and gtin in obsolete:
            rule = next((r for r in active_rules if r["obsolete_identifier"] == gtin
                         and r["customer_id"] == cust_id and r["state"] == "active"), None)
            if rule and rule.get("reference_version") == rv:
                product = products.get(rule["replacement_sku"])
                out["resolved_by"] = {"type": "memory_rule", "rule_id": rule["id"],
                                      "approved_by": rule.get("activated_by"),
                                      "activated_at": rule.get("activated_at"),
                                      "text": f"Resolved by memory rule #{rule['id']} ({gtin} -> "
                                              f"{rule['replacement_identifier']}), activated by "
                                              f"{_person(rule.get('activated_by'))}"}
            else:
                proposal = proposals.get(gtin)
                if key in overrides:  # issue stays listed so the card shows who resolved it
                    product = products.get(overrides[key]["replacement_sku"])
                    out["resolved_by"] = {"type": "review_decision", "text": overrides[key]["text"]}
                code = "rule_needs_revalidation" if rule else "outdated_identifier"
                msg = (f"Line {label}: {gtin} is a retired identifier. "
                       + (f"Supplier notice proposes {proposal['replacement_identifier']}; it needs a reviewer "
                          "decision before use." if proposal else "No approved replacement exists."))
                if rule:
                    msg = (f"Line {label}: memory rule #{rule['id']} was approved against reference "
                           f"{rule.get('reference_version')}; current reference is {rv}. Revalidate before use.")
                issues.append(_issue(code, msg, line=idx, printed=gtin,
                                     reference=proposal["replacement_identifier"] if proposal else None,
                                     proposed=(f"Apply mapping {gtin} -> {proposal['replacement_identifier']} "
                                               f"for {cust_id}") if proposal else None,
                                     evidence=evidence, page=page, ref_version=rv,
                                     extra={"proposal": proposal}) | {"key": key})
        elif product is None:
            mkey = f"unknown_item:{idx}"
            if mkey in overrides:
                product = products.get(overrides[mkey]["sku"])
                out["resolved_by"] = {"type": "review_decision", "text": overrides[mkey]["text"]}
            issues.append(_issue("unknown_item", f"Line {label}: '{alias or gtin or 'no identifier'}' does not "
                                 f"match any product for {cust_id or 'this customer'}.", line=idx,
                                 printed=alias or gtin, evidence=evidence, page=page, ref_version=rv,
                                 extra={"candidate_skus": [p["sku"] for p in ref["products"]]}))
        if product is None:
            lines_out.append(out)
            if amount is not None:
                computed_subtotal += amount
            continue
        out["sku"], out["gtin"] = product["sku"], product.get("gtin")
        out["description_reference"] = product["description"]

        # ---- unit conversion (only with a supplied approved factor) ----
        dq, dp, dunit = q, price, unit
        if q is not None and unit and unit != product["unit"]:
            conv = next((c for c in ref.get("unit_conversions", []) if c["sku"] == product["sku"]
                         and c["from_unit"] == unit and c["to_unit"] == product["unit"] and c.get("approved")), None)
            if conv is None:
                issues.append(_issue("unknown_unit", f"Line {label}: no approved conversion from {unit} to "
                                     f"{product['unit']}. Pack size is never guessed.", line=idx, printed=unit,
                                     reference=product["unit"], evidence=evidence, page=page, ref_version=rv))
                dq = None
            else:
                factor = Decimal(conv["factor"])
                dq = q / factor if conv["direction"] == "divide" else q * factor
                dp = (price * factor if conv["direction"] == "divide" else price / factor) if price is not None else None
                dunit = product["unit"]
                issues.append(_issue("unit_conversion", f"Line {label}: {qty(q)} {unit} = {qty(dq)} {dunit} using "
                                     f"supplied factor {conv['factor']}; unit price {money(dp) if dp else '?'} per "
                                     f"{dunit}.", line=idx, printed=f"{qty(q)} {unit}",
                                     reference=f"{qty(dq)} {dunit}", proposed="Confirm supplied conversion",
                                     evidence=evidence, page=page, ref_version=rv))
        edit = overrides.get(f"edit:{idx}", {})
        if edit.get("quantity") is not None:
            dq = dec(edit["quantity"])
            out["edited"] = True
        if edit.get("unit_price") is not None:
            dp = dec(edit["unit_price"])
            out["edited"] = True
        out.update(quantity=qty(dq) if dq is not None else None, unit=dunit if dq is not None else None,
                   unit_price=money(dp) if dp is not None else None)
        if dq is not None and dp is not None:
            out["line_amount"] = money(dq * dp)

        # ---- MOQ (in the rule's unit; quantity is never raised) ----
        moq = next((m for m in ref.get("moq_rules", []) if m["customer_id"] == cust_id
                    and m["sku"] == product["sku"]), None)
        if moq and dq is not None and dunit == moq["unit"] and dq < Decimal(moq["minimum"]):
            issues.append(_issue("moq_violation", f"Line {label}: {qty(dq)} {dunit} is below the minimum of "
                                 f"{moq['minimum']} {moq['unit']}. The quantity is not changed automatically.",
                                 line=idx, printed=f"{qty(dq)} {dunit}", reference=f"{moq['minimum']} {moq['unit']}",
                                 proposed="Ask the customer to correct, or record an authorised one-off exception",
                                 evidence=evidence, page=page, ref_version=moq["version"]))
        # ---- price (printed and reference both preserved) ----
        rp = next((p for p in ref.get("reference_prices", []) if p["customer_id"] == cust_id
                   and p["sku"] == product["sku"] and p["unit"] == dunit and p["currency"] == currency), None)
        if rp and dp is not None and dp.quantize(CENT) != Decimal(rp["price"]):
            issues.append(_issue("price_mismatch", f"Line {label}: printed {money(dp)} {currency} per {dunit}; "
                                 f"agreed price is {rp['price']}.", line=idx, printed=money(dp),
                                 reference=rp["price"],
                                 proposed="Accept printed price with a reason, or correct it",
                                 evidence=evidence, page=page, ref_version=rv))
        # ---- printed line amount ----
        if q is not None and price is not None and amount is not None and money(q * price) != money(amount):
            issues.append(_issue("line_amount_mismatch", f"Line {label}: {qty(q)} x {money(price)} = "
                                 f"{money(q * price)}, but {money(amount)} is printed.", line=idx,
                                 printed=money(amount), reference=money(q * price), evidence=evidence, page=page))
        computed_subtotal += Decimal(out["line_amount"]) if out["line_amount"] else (amount or Decimal("0"))
        lines_out.append(out)

    printed = {k: _v(header.get(k)) for k in ("subtotal", "tax", "shipping", "total")}
    tax, shipping = dec(printed["tax"]) or Decimal("0"), dec(printed["shipping"]) or Decimal("0")
    computed_total = computed_subtotal + tax + shipping
    totals = {"printed_subtotal": printed["subtotal"], "printed_tax": printed["tax"],
              "printed_shipping": printed["shipping"], "printed_total": printed["total"],
              "computed_subtotal": money(computed_subtotal), "computed_total": money(computed_total),
              "rounding": "ROUND_HALF_UP to 0.01"}
    if dec(printed["subtotal"]) is not None and money(dec(printed["subtotal"])) != money(computed_subtotal):
        issues.append(_issue("total_mismatch", f"Lines add up to {money(computed_subtotal)}; printed subtotal is "
                             f"{printed['subtotal']}. The printed value is kept.", printed=printed["subtotal"],
                             reference=money(computed_subtotal)) | {"key": "total_mismatch:subtotal"})
    if dec(printed["total"]) is None:
        issues.append(_issue("total_mismatch", "No printed total was found.", reference=money(computed_total))
                      | {"key": "total_mismatch:total"})
    elif money(dec(printed["total"])) != money(computed_total):
        issues.append(_issue("total_mismatch", f"Computed total {money(computed_total)}; printed total is "
                             f"{printed['total']}. The printed value is kept.", printed=printed["total"],
                             reference=money(computed_total)) | {"key": "total_mismatch:total"})

    for other in other_orders or []:
        if cust_id and po and other.get("customer_id") == cust_id and other.get("po_number") == po:
            issues.append(_issue("possible_revision", f"PO {po} for {cust_id} was already received as order "
                                 f"#{other['document_id']} with different content. Held as a possible revision.",
                                 printed=po, reference=f"order #{other['document_id']}",
                                 extra={"other_document_id": other["document_id"]}))
            break

    order = {
        "customer_id": cust_id, "customer_name": customer["name"] if customer else customer_name,
        "po_number": po, "currency": currency, "ship_to_id": ship_to,
        "order_date": _v(header.get("order_date")),
        "requested_delivery_date": _v(header.get("requested_delivery_date")),
        "lines": lines_out, "totals": totals, "reference_version": rv, "policy_version": ref["policy_version"],
    }
    return {"order": order, "issues": issues}
