"""Slice 1: fixture integrity, fictional labelling, secret hygiene, skeleton."""
import email
import hashlib
import json
import re
import subprocess
import sys
from decimal import Decimal
from pathlib import Path

from fastapi.testclient import TestClient
from pypdf import PdfReader

from app.main import app

ROOT = Path(__file__).resolve().parents[2]
GEN = ROOT / "fixtures" / "demo" / "generated"
ORDERS = json.loads((ROOT / "fixtures/demo/orders.json").read_text())["orders"]
GOLDEN = json.loads((ROOT / "fixtures/demo/golden-expected.json").read_text())
REF = json.loads((ROOT / "fixtures/reference-data.v1.json").read_text())


def test_demo_totals_match_golden_with_decimal():
    for order in ORDERS:
        subtotal = sum((Decimal(l["quantity"]) * Decimal(l["unit_price"]) for l in order["lines"]), Decimal("0"))
        total = subtotal + Decimal(order["tax"]) + Decimal(order["shipping"])
        golden = GOLDEN[order["po_number"]]
        assert subtotal == Decimal(golden["subtotal"])
        assert total == Decimal(golden["total"]) == Decimal(order["total"])


def test_regression_sample_matches_golden():
    golden = json.loads((ROOT / "fixtures/regression/golden-expected.json").read_text())
    total = sum((Decimal(l["amount"]) for l in golden["resolved_lines"]), Decimal("0"))
    assert total == Decimal(golden["total"]) == Decimal("378.00")


def test_money_values_are_strings_not_floats():
    def walk(node):
        if isinstance(node, float):
            raise AssertionError(f"binary float in fixture: {node}")
        if isinstance(node, dict):
            for v in node.values():
                walk(v)
        if isinstance(node, list):
            for v in node:
                walk(v)
    for path in (ROOT / "fixtures").rglob("*.json"):
        walk(json.loads(path.read_text()))


def test_video_demo_001_has_exactly_three_rule_triggers():
    order = next(o for o in ORDERS if o["po_number"] == "VIDEO-DEMO-001")
    prices = {(p["customer_id"], p["sku"]): Decimal(p["price"]) for p in REF["reference_prices"]}
    gtin_to_sku = {p["gtin"]: p["sku"] for p in REF["products"] if p["gtin"]}
    moq = {(m["customer_id"], m["sku"]): Decimal(m["minimum"]) for m in REF["moq_rules"]}
    obsolete = {o["identifier"] for o in REF["obsolete_identifiers"]}
    triggers = []
    for line in order["lines"]:
        if line["gtin"] in obsolete:
            triggers.append(("gtin", line["line"]))
            continue
        sku = gtin_to_sku[line["gtin"]]
        key = (order["customer_id"], sku)
        if key in moq and Decimal(line["quantity"]) < moq[key]:
            triggers.append(("moq", line["line"]))
        if Decimal(line["unit_price"]) != prices[key]:
            triggers.append(("price", line["line"]))
    assert sorted(triggers) == [("gtin", "C"), ("moq", "A"), ("price", "B")]


def test_proposed_mapping_is_not_active():
    assert all(m["state"] == "proposed" for m in REF["proposed_identifier_mappings"])


def test_generated_pdfs_have_native_text_and_fictional_label():
    pdfs = sorted(GEN.glob("*.pdf"))
    assert len(pdfs) == 4
    for pdf in pdfs:
        reader = PdfReader(str(pdf))
        assert not reader.is_encrypted
        for page in reader.pages:
            assert "FICTIONAL TEST DATA" in page.extract_text()


def test_generated_emails_are_labelled_and_carry_pdf():
    for eml in sorted(GEN.glob("*.eml")):
        msg = email.message_from_bytes(eml.read_bytes())
        assert "FICTIONAL TEST DATA" in msg["Subject"]
        assert msg["Message-ID"].endswith("@demo.invalid>")
        attachments = [p for p in msg.walk() if p.get_content_type() == "application/pdf"]
        assert len(attachments) == 1
        assert attachments[0].get_payload(decode=True).startswith(b"%PDF")


def test_generator_is_reproducible():
    before = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in GEN.iterdir()}
    subprocess.run([sys.executable, str(ROOT / "scripts/generate_fixtures.py")], check=True, capture_output=True)
    after = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in GEN.iterdir()}
    assert before == after


def test_no_secrets_in_tracked_files():
    files = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
    pattern = re.compile(r"(AIza[0-9A-Za-z_\-]{30,}|sk-[A-Za-z0-9]{20,}|GEMINI_API_KEY=\S+)")
    for name in files:
        path = ROOT / name
        if path.suffix in {".pdf", ".docx", ".lock"} or not path.is_file():
            continue
        assert not pattern.search(path.read_text(errors="ignore")), name


def test_health_reports_extraction_unavailable_without_key(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    body = TestClient(app).get("/api/health").json()
    assert body["status"] == "ok"
    assert body["extraction"] == "unavailable"
