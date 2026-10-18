"""Write the fictional purchase orders the session-onboarding screens upload (D46, D75).

FICTIONAL TEST DATA. "Birchwood Test Market Ltd." and its items are invented; they are deliberately NOT in
reference-data.v1.json, like a real retailer the supplier has not set up yet. Like that real PO, these print no
customer ID and no ship-to ID.
  ONBOARD-01.pdf  first order: unknown customer and two unknown products
  ONBOARD-02.pdf  repeat order from the same customer with the same products (clean once onboarded)

Usage (from the repository root, after pip install -r tools/requirements.lock):
  python3 scripts/onboarding_fixtures.py
"""
from __future__ import annotations

from pathlib import Path

from reportlab.lib.pagesizes import LETTER
from reportlab.pdfgen import canvas

BANNER = "FICTIONAL TEST DATA - NOT A REAL CUSTOMER ORDER"


def draw_page_frame(c: canvas.Canvas) -> None:
    c.setFont("Helvetica-Bold", 10)
    _, height = LETTER
    c.drawString(40, height - 30, BANNER)
    c.drawString(40, 25, BANNER)


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "fixtures" / "onboarding"

ORDERS = [
    {"file": "ONBOARD-01", "po": "BW-TEST-5001", "date": "2026-10-15", "lines": [
        ["1", "FICT-GTIN-7001", "Test maple cookies 300g", "40", "CASE", "12.50", "500.00"],
        ["2", "FICT-GTIN-7002", "Test apple chips 150g", "25", "CASE", "9.80", "245.00"],
    ], "subtotal": "745.00", "tax": "96.85", "shipping": "20.00", "total": "861.85"},
    {"file": "ONBOARD-02", "po": "BW-TEST-5002", "date": "2026-10-16", "lines": [
        ["1", "FICT-GTIN-7001", "Test maple cookies 300g", "10", "CASE", "12.50", "125.00"],
        ["2", "FICT-GTIN-7002", "Test apple chips 150g", "5", "CASE", "9.80", "49.00"],
    ], "subtotal": "174.00", "tax": "22.62", "shipping": "0.00", "total": "196.62"},
]


def write(order: dict, path: Path) -> None:
    c = canvas.Canvas(str(path), pagesize=LETTER, invariant=1)
    c.setTitle(f"Fictional purchase order {order['po']}")
    _, height = LETTER
    draw_page_frame(c)
    y = height - 70
    c.setFont("Helvetica-Bold", 16)
    c.drawString(40, y, "PURCHASE ORDER")
    y -= 28
    c.setFont("Helvetica", 11)
    for label, value in [("PO", order["po"]), ("Customer", order.get("customer", "Birchwood Test Market Ltd.")),
                         ("Supplier", "Northern Foods Manufacturing Inc."), ("Order date", order["date"]),
                         ("Requested delivery date", "2026-10-28"), ("Currency", order.get("currency", "USD"))]:
        c.drawString(40, y, f"{label}: {value}")
        y -= 16
    y -= 12
    c.setFont("Helvetica-Bold", 10)
    c.drawString(40, y, "Line | GTIN | Description | Quantity | Unit | Unit price | Amount")
    y -= 16
    c.setFont("Helvetica", 10)
    for line in order["lines"]:
        c.drawString(40, y, " | ".join(line))
        y -= 16
    y -= 12
    c.setFont("Helvetica", 11)
    for label, key in [("Subtotal", "subtotal"), ("Tax amount", "tax"), ("Shipping amount", "shipping"),
                       ("Total", "total")]:
        c.drawString(400, y, f"{label}: {order[key]}")
        y -= 16
    y -= 20
    c.setFont("Helvetica-Oblique", 9)
    c.drawString(40, y, "All organisations, identifiers and commercial values are fictional test data.")
    c.showPage()
    c.save()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for order in ORDERS:
        write(order, OUT / f"{order['file']}.pdf")
        print(order["file"])


if __name__ == "__main__":
    main()
