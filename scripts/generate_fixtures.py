"""Generate fictional demo PDFs and local .eml envelopes.

Every page and every email is labelled FICTIONAL TEST DATA.
Run: backend/.venv/bin/python scripts/generate_fixtures.py
Output: fixtures/demo/generated/
"""
from __future__ import annotations

import json
from decimal import Decimal
from email.message import EmailMessage
from email.utils import format_datetime
from datetime import datetime, timezone
from pathlib import Path

from reportlab.lib.pagesizes import LETTER
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parent.parent
ORDERS = ROOT / "fixtures" / "demo" / "orders.json"
SAMPLE = ROOT / "fixtures" / "regression" / "sample-po.txt"
OUT = ROOT / "fixtures" / "demo" / "generated"
BANNER = "FICTIONAL TEST DATA - NOT A REAL CUSTOMER ORDER"
# Fixed timestamps keep generated files reproducible.
RECEIVED = {
    "VIDEO-DEMO-001": datetime(2026, 10, 14, 9, 12, tzinfo=timezone.utc),
    "VIDEO-DEMO-002": datetime(2026, 10, 15, 9, 40, tzinfo=timezone.utc),
    "VIDEO-DEMO-003": datetime(2026, 10, 15, 10, 5, tzinfo=timezone.utc),
    "VIDEO-DEMO-004": datetime(2026, 10, 16, 8, 50, tzinfo=timezone.utc),
    "VIDEO-DEMO-005": datetime(2026, 10, 16, 9, 20, tzinfo=timezone.utc),
    "DEMO-PO-001": datetime(2026, 10, 14, 8, 30, tzinfo=timezone.utc),
}


def check_totals(order: dict) -> None:
    """Fail loudly if fixture arithmetic is inconsistent (Decimal only)."""
    subtotal = Decimal("0")
    for line in order["lines"]:
        amount = Decimal(line["quantity"]) * Decimal(line["unit_price"])
        if amount != Decimal(line["amount"]):
            raise ValueError(f"{order['po_number']} line {line['line']}: {amount} != {line['amount']}")
        subtotal += amount
    if subtotal != Decimal(order["subtotal"]):
        raise ValueError(f"{order['po_number']}: subtotal {subtotal} != {order['subtotal']}")
    total = subtotal + Decimal(order["tax"]) + Decimal(order["shipping"])
    if total != Decimal(order["total"]):
        raise ValueError(f"{order['po_number']}: total {total} != {order['total']}")


def draw_page_frame(c: canvas.Canvas) -> None:
    width, height = LETTER
    c.setFont("Helvetica-Bold", 10)
    c.drawString(40, height - 30, BANNER)
    c.drawString(40, 25, BANNER)


def write_order_pdf(order: dict, path: Path) -> None:
    c = canvas.Canvas(str(path), pagesize=LETTER, invariant=1)
    c.setTitle(f"Fictional purchase order {order['po_number']}")
    width, height = LETTER
    draw_page_frame(c)
    y = height - 70
    c.setFont("Helvetica-Bold", 16)
    c.drawString(40, y, "PURCHASE ORDER")
    y -= 28
    c.setFont("Helvetica", 11)
    for label, value in [
        ("PO", order["po_number"]),
        ("Customer", order["customer_name"]),
        ("Customer ID", order["customer_id"]),
        ("Supplier", order["supplier"]),
        ("Ship-to", order["ship_to_id"]),
        ("Order date", order["order_date"]),
        ("Requested delivery date", order["requested_delivery_date"]),
        ("Currency", order["currency"]),
    ]:
        c.drawString(40, y, f"{label}: {value}")
        y -= 16
    y -= 12
    # One text run per row (pipe-separated) so native text extraction keeps rows intact.
    c.setFont("Helvetica-Bold", 10)
    c.drawString(40, y, "Line | GTIN | Description | Quantity | Unit | Unit price | Amount")
    y -= 16
    c.setFont("Helvetica", 10)
    for line in order["lines"]:
        c.drawString(40, y, " | ".join([line["line"], line["gtin"], line["description"],
                                         line["quantity"], line["unit"], line["unit_price"],
                                         line["amount"]]))
        y -= 16
    y -= 12
    c.setFont("Helvetica", 11)
    for label, key in [("Subtotal", "subtotal"), ("Tax amount", "tax"),
                       ("Shipping amount", "shipping"), ("Total", "total")]:
        c.drawString(400, y, f"{label}: {order[key]}")
        y -= 16
    y -= 20
    c.setFont("Helvetica-Oblique", 9)
    c.drawString(40, y, "All organisations, identifiers and commercial values are fictional test data.")
    c.drawString(40, y - 12, "Identifiers such as OLD-DEMO-003 are intentionally not valid GS1 GTINs.")
    c.showPage()
    c.save()


def write_text_pdf(text: str, title: str, path: Path) -> None:
    c = canvas.Canvas(str(path), pagesize=LETTER, invariant=1)
    c.setTitle(title)
    width, height = LETTER
    draw_page_frame(c)
    y = height - 70
    c.setFont("Helvetica", 10)
    for raw in text.splitlines():
        c.drawString(40, y, raw)
        y -= 15
    c.showPage()
    c.save()


def write_eml(po: str, sender: str, subject: str, pdf_path: Path, path: Path) -> None:
    msg = EmailMessage()
    msg["From"] = sender
    msg["To"] = "order-agent@supplier-demo.example"
    msg["Subject"] = f"Fwd: {subject} [FICTIONAL TEST DATA]"
    msg["Date"] = format_datetime(RECEIVED[po])
    msg["Message-ID"] = f"<{po.lower()}@demo.invalid>"
    msg["X-Demo-Notice"] = "Fictional local demo envelope. Not sent over the internet."
    msg.set_content(
        f"{BANNER}\n\nForwarded fictional purchase order {po}. "
        "Order details are in the attached PDF.\n"
    )
    msg.add_attachment(pdf_path.read_bytes(), maintype="application", subtype="pdf",
                       filename=pdf_path.name)
    msg.set_boundary(f"demo-boundary-{po.lower()}")
    path.write_bytes(bytes(msg))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    data = json.loads(ORDERS.read_text())
    for order in data["orders"]:
        check_totals(order)
        pdf = OUT / f"{order['file']}.pdf"
        write_order_pdf(order, pdf)
        write_eml(order["po_number"], order["sender"], order["subject"], pdf,
                  OUT / f"{order['file']}.eml")
    sample_pdf = OUT / "DEMO-PO-001.pdf"
    write_text_pdf(SAMPLE.read_text(), "Fictional purchase order DEMO-PO-001", sample_pdf)
    write_eml("DEMO-PO-001", "orders@northfield-demo.example", "PO DEMO-PO-001",
              sample_pdf, OUT / "DEMO-PO-001.eml")
    print(f"Generated {len(list(OUT.iterdir()))} files in {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
