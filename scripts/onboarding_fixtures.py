"""Write the fictional purchase orders the session-onboarding tests upload (D46).

FICTIONAL TEST DATA. "Birchwood Demo Market" and its items are invented; they are deliberately NOT in
reference-data.v1.json, like a real retailer the supplier has not set up yet. Like that real PO, these print no
customer ID and no ship-to ID.
  ONBOARD-DEMO-001.pdf  first order: unknown customer and two unknown products
  ONBOARD-DEMO-002.pdf  repeat order from the same customer with the same products (clean once onboarded)

Usage (from the repository root):
  backend/.venv/bin/python scripts/onboarding_fixtures.py
"""
from __future__ import annotations

import sys
from pathlib import Path

from reportlab.lib.pagesizes import LETTER
from reportlab.pdfgen import canvas

sys.path.insert(0, str(Path(__file__).resolve().parent))
from generate_fixtures import draw_page_frame  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "fixtures" / "onboarding"

ORDERS = [
    {"file": "ONBOARD-DEMO-001", "po": "BW-DEMO-5001", "date": "2026-10-15", "lines": [
        ["1", "FICT-GTIN-7001", "Demo maple cookies 300g", "40", "CASE", "12.50", "500.00"],
        ["2", "FICT-GTIN-7002", "Demo apple chips 150g", "25", "CASE", "9.80", "245.00"],
    ], "subtotal": "745.00", "tax": "96.85", "shipping": "20.00", "total": "861.85"},
    {"file": "ONBOARD-DEMO-002", "po": "BW-DEMO-5002", "date": "2026-10-16", "lines": [
        ["1", "FICT-GTIN-7001", "Demo maple cookies 300g", "10", "CASE", "12.50", "125.00"],
        ["2", "FICT-GTIN-7002", "Demo apple chips 150g", "5", "CASE", "9.80", "49.00"],
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
    for label, value in [("PO", order["po"]), ("Customer", "Birchwood Demo Market"),
                         ("Supplier", "Marlow Demo Foods"), ("Order date", order["date"]),
                         ("Requested delivery date", "2026-10-28"), ("Currency", "CAD")]:
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
