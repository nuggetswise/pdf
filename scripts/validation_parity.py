"""Write the Python side of the TypeScript parity check (Vercel rebuild slice 2).

Runs the Python decimal helpers, normalise() and validate() on every fixture, the regression sample and a
set of edge cases, and records each input with Python's exact json.dumps output. Vitest
(frontend/lib/domain/parity.test.ts) runs the TypeScript port on the same inputs and requires identical
bytes. scripts/verify.sh regenerates this file and fails if it no longer matches the committed copy.

Usage (from the repository root):
  backend/.venv/bin/python scripts/validation_parity.py [out.json]
"""
from __future__ import annotations

import copy
import json
import sys
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.extraction import FixtureTestExtractor, normalise, read_pdf_pages  # noqa: E402
from app.validation import dec, load_reference, money, qty, validate  # noqa: E402

OUT = ROOT / "frontend" / "lib" / "domain" / "__fixtures__" / "validation-parity.json"
EX = FixtureTestExtractor()
REF = load_reference()
EXTRACTOR = {"name": EX.name, "is_ai": EX.is_ai}

# ---------- decimal helpers ----------

DECIMAL_INPUTS = ["5", "5.00", "2.50", "-3", "-0", "0", "0.00", "24.005", "24.015", "1,234.50", "1e1", "1E+3",
                  "2.5e-3", ".5", "5.", "1_000", "+7", " 12 ", " 9 ", "١٢", "0.0000001",
                  "1234567890123456789012345.125", "abc", "", "1.2.3", "e5", "0x10", "12abc"]
BINARY_PAIRS = [("5", "12"), ("25", "12"), ("24", "12"), ("2.0", "12"), ("1", "3"), ("100", "1"), ("0", "12"),
                ("2.50", "4"), ("-7", "3"), ("1.005", "0.5"), ("12345678901234567890123", "7"),
                ("0.1", "0.2"), ("10", "0.25")]


def decimal_cases() -> list[dict]:
    cases = []
    for s in DECIMAL_INPUTS:
        d = dec(s)
        cases.append({"input": s, "expected": json.dumps(None if d is None else {
            "str": str(d), "money": money(d), "qty": qty(d), "integral": d == d.to_integral()})})
    for a, b in BINARY_PAIRS:
        x, y = Decimal(a), Decimal(b)
        cases.append({"input": [a, b], "expected": json.dumps({
            "add": str(x + y), "mul": str(x * y), "div": str(x / y), "lt": x < y,
            "q_even": str((x / y).quantize(Decimal("0.01"))), "money_div": money(x / y), "qty_div": qty(x / y)})})
    return cases

# ---------- extraction normalisation ----------

def pages_of(name: str) -> list[str]:
    path = ROOT / name
    return read_pdf_pages(path.read_bytes()) if path.suffix == ".pdf" else [path.read_text()]


SOURCES = sorted(f"fixtures/demo/generated/{p.name}" for p in (ROOT / "fixtures/demo/generated").glob("*.pdf"))
SOURCES.append("fixtures/regression/sample-po.txt")

SAMPLE = """FICTIONAL TEST PURCHASE ORDER
PO: {po}
Customer: {name}
Customer ID: {cust}
Ship-to: {ship}
Currency: {cur}
Line | GTIN | Customer item | Description | Quantity | Unit | Unit price | Amount
{lines}
Subtotal: {subtotal}
Tax amount: {tax}
Shipping amount: 0.00
Total: {total}
"""
BASE = dict(po="EDGE-1", name="Northfield Demo Retail", cust="DEMO-CUST-01", ship="DEMO-DC-01", cur="USD",
            lines="A | 614141000012 |  | Demo granola case | 10 | CASE | 24.00 | 240.00",
            subtotal="240.00", tax="0.00", total="240.00")


def sample(**kw) -> str:
    text = SAMPLE.format(**{**BASE, **kw})
    return "\n".join(l for l in text.splitlines() if not l.endswith(": DROP")) + "\n"


EDGE_TEXTS = {
    "unknown customer": sample(cust="DEMO-CUST-99"),
    "customer by name only": sample(cust="DROP", name="northfield DEMO retail"),
    "unknown customer by name": sample(cust="DROP", name="Nobody Demo"),
    "unknown ship-to": sample(ship="DEMO-DC-99"),
    "missing ship-to": sample(ship="DROP"),
    "missing currency": sample(cur="DROP"),
    "currency mismatch": sample(cur="USD"),
    "missing PO": sample(po="DROP"),
    "total mismatch": sample(total="250.00"),
    "subtotal mismatch": sample(subtotal="230.00"),
    "missing total": sample(total="DROP"),
    "unreadable total": sample(total="n/a"),
    "tax and shipping": sample(tax="12.50", total="252.50"),
    "line amount mismatch": sample(lines="A | 614141000012 |  | Demo granola case | 10 | CASE | 24.00 | 250.00"),
    "decimal quantity": sample(lines="A | 614141000012 |  | Demo granola case | 12.50 | CASE | 24.00 | 300.00",
                               subtotal="300.00", total="300.00"),
    "half-even vs half-up price": sample(
        lines="A | 614141000012 |  | Demo granola case | 10 | CASE | 24.005 | 240.05",
        subtotal="240.05", total="240.05"),
    "half-even vs half-up price 2": sample(
        lines="A | 614141000012 |  | Demo granola case | 10 | CASE | 23.995 | 239.95",
        subtotal="239.95", total="239.95"),
    "thousands separator": sample(lines="A | 614141000012 |  | Demo granola case | 100 | CASE | 24.00 | 2,400.00",
                                  subtotal="2,400.00", total="2,400.00"),
    "exponent quantity": sample(lines="A | 614141000012 |  | Demo granola case | 1e1 | CASE | 24.00 | 240.00"),
    "unreadable quantity": sample(lines="A | 614141000012 |  | Demo granola case | ten | CASE | 24.00 | 240.00"),
    "missing unit": sample(lines="A | 614141000012 |  | Demo granola case | 10 |  | 24.00 | 240.00"),
    "negative quantity": sample(lines="A | 614141000012 |  | Demo granola case | -3 | CASE | 24.00 | -72.00",
                                subtotal="-72.00", total="-72.00"),
    "unknown unit": sample(lines="A | 614141000012 |  | Demo granola case | 10 | EA | 2.00 | 20.00",
                           subtotal="20.00", total="20.00"),
    "conversion exact": sample(lines="1 |  | NF-JUICE | Juice bottles | 24 | EA | 2.00 | 48.00",
                               subtotal="48.00", total="48.00"),
    "conversion repeating": sample(lines="1 |  | NF-JUICE | Juice bottles | 25 | EA | 2.00 | 50.00",
                                   subtotal="50.00", total="50.00"),
    "conversion zero price": sample(lines="1 |  | NF-JUICE | Juice bottles | 24 | EA | 0.00 | 0.00",
                                    subtotal="0.00", total="0.00"),
    "conversion odd price": sample(lines="1 |  | NF-JUICE | Juice bottles | 7 | EA | 1.99 | 13.93",
                                   subtotal="13.93", total="13.93"),
    "unknown alias": sample(lines="3 |  | NF-NEW | New snack case | 5 | CASE | 18.00 | 90.00",
                            subtotal="90.00", total="90.00"),
    "no identifier": sample(lines="3 |  |  | Mystery case | 5 | CASE | 18.00 | 90.00", subtotal="90.00",
                            total="90.00"),
    "MOQ met": sample(lines="A | 614141000012 |  | Demo granola case | 10 | CASE | 24.00 | 240.00"),
    "obsolete without proposal": sample(
        lines="A | 614141000043 |  | Demo trail mix case | 1 | CASE | 18.00 | 18.00", subtotal="18.00",
        total="18.00"),
    "multi lines": sample(lines="\n".join([
        "A | 614141000012 |  | Demo granola case | 5 | CASE | 24.00 | 120.00",
        "B | 614141000029 |  | Demo cracker case | 2 | CASE | 26.00 | 52.00",
        "C | 614141000043 |  | Demo trail mix case | 1 | CASE | 18.00 | 18.00",
        "D |  | NF-OAT | Oat snack case | 3 | CASE | 23.00 | 69.00"]), subtotal="259.00", total="259.00"),
    "non-ascii text": sample(name="Northfield Démo Retail — été", cust="DROP"),
}

# Raw extractor results that never come from the fixture parser (e.g. a model's answer).
RAW_PAGES = ["PO: RAW-1\nCustomer ID: DEMO-CUST-01\nTotal: 1,200.00\nShip-to:   DEMO-DC-01 x"]
RAW_RESULTS = {
    "values with evidence and pages": {"header": {
        "po_number": {"value": " RAW-1 ", "page": 1, "evidence": "PO: RAW-1"},
        "customer_id": {"value": "demo-cust-01", "page": 1, "evidence": ""},
        "total": {"value": "1,200.00", "page": 1, "evidence": "Total: 1,200.00"},
        "ship_to_id": {"value": "DEMO-DC-01 X", "page": None}}, "lines": []},
    "invented and malformed values": {"header": {
        "po_number": {"value": "RAW-2", "page": 1},
        "subtotal": {"value": "twelve", "page": 7},
        "tax": {"value": "", "page": 1},
        "currency": "USD",
        "customer_name": None}, "lines": [
        {"quantity": {"value": "abc", "page": 1}, "unit_price": "1,200.00"}, None, {}]},
    "empty result": {},
    "integer value": {"header": {"total": {"value": 5, "page": 1}}, "lines": [{"line_amount": 1200}]},
}


def normalise_cases() -> tuple[list[dict], dict[str, dict]]:
    cases, payloads = [], {}
    inputs = [(name, pages_of(name), None) for name in SOURCES]
    inputs += [(f"edge: {k}", [t], None) for k, t in EDGE_TEXTS.items()]
    inputs += [(f"raw: {k}", RAW_PAGES, r) for k, r in RAW_RESULTS.items()]
    for name, pages, raw in inputs:
        raw = EX.extract(pages) if raw is None else raw
        out = normalise(copy.deepcopy(raw), pages, EX)
        payloads[name] = out
        cases.append({"name": name, "input": {"raw": raw, "pages": pages, "extractor": EXTRACTOR},
                      "expected": json.dumps(out)})
    return cases, payloads

# ---------- validation ----------

def rule(**kw) -> dict:
    base = {"id": 7, "kind": "identifier_mapping", "customer_id": "DEMO-CUST-01", "obsolete_identifier": "614141000043",
            "replacement_identifier": "614141000036", "replacement_sku": "DEMO-SKU-C",
            "reference_version": REF["reference_version"], "state": "active", "source_document_id": 1,
            "source_decision_id": 3, "evidence": None, "created_by": "reviewer:rita",
            "created_at": "2026-10-15T10:00:00.000+00:00", "activated_by": "administrator:alex",
            "activated_at": "2026-10-15T10:05:00.000+00:00", "revoked_by": None, "revoked_at": None,
            "revoke_reason": None}
    return {**base, **kw}


REF_V2 = {**copy.deepcopy(REF), "reference_version": "REF-2026-11-v2"}
SCENARIOS = {
    "plain": {},
    "active memory rule": {"rules": [rule()]},
    "rule for another customer": {"rules": [rule(customer_id="DEMO-CUST-02")]},
    "candidate rule ignored": {"rules": [rule(state="candidate")]},
    "rule needs revalidation": {"rules": [rule()], "ref": REF_V2},
    "rule without activator": {"rules": [rule(activated_by=None, activated_at=None)]},
    "rule with bare actor": {"rules": [rule(activated_by="alex")]},
    "reviewer mapping": {"overrides": {"outdated_identifier:2": {
        "replacement_sku": "DEMO-SKU-C", "text": "Mapping 614141000043 -> 614141000036 approved by rita (decision #3)"}}},
    "revalidation with reviewer mapping": {"rules": [rule()], "ref": REF_V2, "overrides": {"outdated_identifier:2": {
        "replacement_sku": "DEMO-SKU-C", "text": "Mapped again by rita (decision #9)"}}},
    "item mapped by reviewer": {"overrides": {"unknown_item:2": {"sku": "NEW-CASE", "text": "Mapped to NEW-CASE by rita"},
                                              "unknown_item:0": {"sku": "NEW-CASE", "text": "Mapped to NEW-CASE by rita"}}},
    "quantity and price edits": {"overrides": {"edit:0": {"quantity": "12"}, "edit:1": {"unit_price": "24.00"}}},
    "decimal edits": {"overrides": {"edit:0": {"quantity": "10.50", "unit_price": "23.995"}}},
    "unreadable edit": {"overrides": {"edit:0": {"quantity": "lots"}}},
    "possible revision": {"others": [{"document_id": 1, "customer_id": "DEMO-CUST-01", "po_number": None},
                                     {"document_id": 2, "customer_id": "DEMO-CUST-01", "po_number": "VIDEO-DEMO-001"},
                                     {"document_id": 3, "customer_id": "DEMO-CUST-01", "po_number": "EDGE-1"},
                                     {"document_id": 4, "customer_id": "DEMO-CUST-01", "po_number": "DEMO-PO-001"}]},
}


REFS = {"v1": REF, "v2": REF_V2}


def validate_cases(payloads: dict[str, dict]) -> list[dict]:
    """Inputs name their payload (a normalise case) and reference data ("v1" bundled, "v2" a new version)."""
    cases = []
    for pname, payload in payloads.items():
        every = pname in SOURCES or pname == "edge: multi lines"
        for sname, sc in (SCENARIOS if every else {"plain": {}}).items():
            ref = "v2" if sc.get("ref") is REF_V2 else "v1"
            inp = {"payload": pname, "ref": ref, "rules": sc.get("rules"), "overrides": sc.get("overrides"),
                   "others": sc.get("others")}
            out = validate(copy.deepcopy(payload), copy.deepcopy(REFS[ref]), copy.deepcopy(inp["rules"]),
                           copy.deepcopy(inp["overrides"]), copy.deepcopy(inp["others"]))
            cases.append({"name": f"{pname} / {sname}", "input": inp, "expected": json.dumps(out)})
    return cases


def build() -> dict:
    norm, payloads = normalise_cases()
    return {"notice": "FICTIONAL TEST DATA. Generated by scripts/validation_parity.py; do not edit by hand.",
            "refs": REFS, "decimal": decimal_cases(), "normalise": norm, "validate": validate_cases(payloads)}


if __name__ == "__main__":
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else OUT
    out.write_text(json.dumps(build(), indent=1, ensure_ascii=False) + "\n")
