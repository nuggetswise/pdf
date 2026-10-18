"""Generate the one example purchase order the app offers (D60), modelled on the owner's sample PO layout, in USD.

A retailer-style layout: header blocks, a buyer/supplier grid, an order-lines table with the supplier's own SKUs
(no GTINs), totals, delivery requirements and order notes. Every page says it is a fictional sample.
Run: backend/.venv/bin/python scripts/example_po.py
Output: fixtures/example/ (PDF and forwarded .eml) and copies in frontend/public/demo/.
"""
from __future__ import annotations

import shutil
from datetime import datetime, timezone
from decimal import Decimal
from email.message import EmailMessage
from email.utils import format_datetime
from pathlib import Path

from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import LETTER
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "fixtures" / "example"
PUBLIC = ROOT / "frontend" / "public" / "demo"
NAME = "PO-2026-104587"
RECEIVED = datetime(2026, 10, 15, 13, 42, tzinfo=timezone.utc)
SENDER = "procurement@mapleretail.example"
FOOTER = "Fictional sample purchase order for demonstration and testing. Not a real order."

NAVY = HexColor("#1b3350")
TEAL = HexColor("#2a6f97")
PALE = HexColor("#eef3f8")
RULE = HexColor("#c9d3de")

LINES = [
    ("1", "NF-CRK-001", "Whole Grain Crackers 250g", "Case", "120", "18.50"),
    ("2", "NF-SNP-017", "Cheese Snack Mix 500g", "Case", "85", "24.75"),
    ("3", "NF-BEV-042", "Sparkling Water Variety Pack 24x355ml", "Case", "150", "14.25"),
    ("4", "NF-CER-010", "Honey Oat Cereal 750g", "Case", "100", "27.40"),
]
FREIGHT = Decimal("275.00")
TAX = Decimal("0.00")


def usd(d: Decimal) -> str:
    return f"USD {d:,.2f}"


def box(c: canvas.Canvas, x: float, y: float, w: float, h: float, fill=None) -> None:
    c.setStrokeColor(RULE)
    c.setLineWidth(0.6)
    if fill is not None:
        c.setFillColor(fill)
        c.rect(x, y, w, h, stroke=1, fill=1)
        c.setFillColor(NAVY)
    else:
        c.rect(x, y, w, h, stroke=1, fill=0)


def label_value(c: canvas.Canvas, x: float, y: float, label: str, value: str, size: float = 9.5) -> None:
    c.setFont("Helvetica", 8.5)
    c.setFillColor(HexColor("#41546a"))
    c.drawString(x, y, label)
    c.setFont("Helvetica", size)
    c.setFillColor(NAVY)
    c.drawString(x, y - 14, value)


def write_pdf(path: Path) -> None:
    c = canvas.Canvas(str(path), pagesize=LETTER, invariant=1)
    c.setTitle(f"Fictional sample purchase order {NAME}")
    W, H = LETTER
    L, R = 42, W - 42
    c.setFillColor(NAVY)
    c.setFont("Helvetica-Bold", 26)
    c.drawString(L + 6, H - 80, "PURCHASE ORDER")
    c.setFont("Helvetica", 9.5)
    c.drawString(L + 6, H - 100, "Maple Retail Group Inc. | FreshMart Markets")
    c.setFont("Helvetica-Bold", 9.5)
    c.drawRightString(R - 6, H - 56, "PO NUMBER")
    c.drawRightString(R - 6, H - 69, NAME)
    c.setFont("Helvetica", 9.5)
    c.drawRightString(R - 6, H - 92, "PO DATE")
    c.drawRightString(R - 6, H - 105, "October 15, 2026")
    c.setStrokeColor(TEAL)
    c.setLineWidth(1.5)
    c.line(L, H - 115, R, H - 115)

    # Terms strip
    y = H - 158
    third = (R - L) / 3
    for i, (lab, val) in enumerate([("REQUESTED DELIVERY", "November 20, 2026"), ("PAYMENT TERMS", "Net 30 Days"),
                                    ("CURRENCY", "USD")]):
        box(c, L + i * third, y, third, 42, PALE)
        label_value(c, L + i * third + 12, y + 26, lab, val)

    # Parties
    half = (R - L) / 2
    top = y - 8
    blocks = [
        ("BUYER", ["Maple Retail Group Inc.", "Store Banner: FreshMart Markets", "Buyer Contact: Sarah Thompson",
                   "procurement@mapleretail.example", "+1 614-555-0182"]),
        ("SUPPLIER", ["Northern Foods Manufacturing Inc.", "Supplier ID: SUP-100245", "Contact: David Chen",
                      "orders@northernfoods.example", "+1 312-555-0198"]),
        ("SHIP TO", ["FreshMart Distribution Center", "275 Logistics Parkway", "Columbus, OH 43217", "United States",
                     "Ship-To ID: MAPLE-DC-01"]),
        ("BILL TO", ["Maple Retail Group Inc.", "500 Commerce Boulevard", "Columbus, OH 43215", "United States"]),
    ]
    for row in range(2):
        hdr_y = top - 22 - row * 94
        for col in range(2):
            title, rows = blocks[row * 2 + col]
            x = L + col * half
            box(c, x, hdr_y, half, 22, PALE)
            c.setFont("Helvetica-Bold", 8)
            c.setFillColor(TEAL)
            c.drawString(x + 12, hdr_y + 8, title)
            box(c, x, hdr_y - 72, half, 72)
            c.setFillColor(NAVY)
            c.setFont("Helvetica", 9)
            for i, text in enumerate(rows):
                c.drawString(x + 12, hdr_y - 15 - i * 13, text)

    # Order lines
    y = top - 22 - 94 - 72 - 26
    c.setFont("Helvetica-Bold", 12)
    c.setFillColor(NAVY)
    c.drawString(L + 6, y, "ORDER LINES")
    cols = [("LINE", 32), ("SUPPLIER SKU", 76), ("PRODUCT DESCRIPTION", 176), ("UOM", 42), ("QTY", 40),
            ("UNIT PRICE", 76), ("EXTENDED", 0)]
    widths = [w for _, w in cols]
    widths[-1] = (R - L) - sum(widths[:-1])
    xs = [L]
    for w in widths[:-1]:
        xs.append(xs[-1] + w)
    y -= 26
    c.setFillColor(NAVY)
    c.rect(L, y, R - L, 20, stroke=0, fill=1)
    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 8.5)
    for (name, _), x in zip(cols, xs):
        c.drawString(x + 6, y + 7, name)
    merch = Decimal("0")
    for line, sku, desc, uom, qty, price in LINES:
        y -= 22
        ext = Decimal(qty) * Decimal(price)
        merch += ext
        box(c, L, y, R - L, 22)
        c.setFillColor(NAVY)
        c.setFont("Helvetica", 8.5)
        c.drawCentredString(xs[0] + widths[0] / 2, y + 10, line)
        c.drawString(xs[1] + 6, y + 10, sku)
        c.drawString(xs[2] + 6, y + 10, desc)
        c.drawCentredString(xs[3] + widths[3] / 2, y + 10, uom)
        c.drawCentredString(xs[4] + widths[4] / 2, y + 10, qty)
        c.drawRightString(xs[5] + widths[5] - 8, y + 10, usd(Decimal(price)))
        c.drawRightString(R - 8, y + 10, usd(ext))
    total = merch + FREIGHT + TAX
    assert merch == Decimal("9201.25"), merch
    y -= 18
    for lab, val in [("Merchandise Total", merch), ("Freight", FREIGHT), ("Sales Tax", TAX)]:
        c.setFont("Helvetica", 9)
        c.drawRightString(R - 150, y, lab)
        c.drawRightString(R - 8, y, usd(val))
        y -= 17
    c.setFillColor(PALE)
    c.rect(R - 280, y - 7, 280, 20, stroke=0, fill=1)
    c.setFillColor(NAVY)
    c.setFont("Helvetica-Bold", 9.5)
    c.drawString(R - 270, y, "TOTAL PURCHASE ORDER VALUE")
    c.drawRightString(R - 8, y, usd(total))

    # Delivery requirements
    y -= 30
    c.setFont("Helvetica-Bold", 12)
    c.drawString(L + 6, y, "DELIVERY REQUIREMENTS")
    y -= 10
    reqs = [("Ship Window", "Nov 10 - Nov 17, 2026"), ("Delivery Window", "08:00 AM - 04:00 PM ET"),
            ("Carrier Appointment", "Required"), ("ASN", "Required before arrival"), ("Barcode Standard", "GS1-128"),
            ("Palletized Shipment", "Required")]
    for i, (lab, val) in enumerate(reqs):
        col, row = i % 3, i // 3
        bx, by = L + col * third, y - 32 - row * 32
        box(c, bx, by, third, 32)
        label_value(c, bx + 10, by + 20, lab, val, 9)
    y -= 32 * 2 + 10
    box(c, L, y - 20, half - 60, 20, PALE)
    box(c, L + half - 60, y - 20, half + 60, 20, PALE)
    c.setFont("Helvetica-Bold", 8)
    c.setFillColor(TEAL)
    c.drawString(L + 12, y - 13, "SHIPPING TERMS")
    c.drawString(L + half - 48, y - 13, "ORDER NOTES")
    box(c, L, y - 80, half - 60, 60)
    box(c, L + half - 60, y - 80, half + 60, 60)
    c.setFillColor(NAVY)
    c.setFont("Helvetica", 8.5)
    c.drawString(L + 12, y - 34, "Incoterms: FOB Destination")
    c.drawString(L + 12, y - 47, "Payment: Net 30 Days")
    for i, note in enumerate(["Do not substitute items without approval.", "Ship complete whenever possible.",
                              "Include the PO number on shipping documents and invoices.",
                              "Report expected shortages within 24 hours of order receipt."]):
        c.drawString(L + half - 48, y - 36 - i * 13, f"• {note}")

    c.setStrokeColor(RULE)
    c.setLineWidth(0.6)
    c.line(L, 36, R, 36)
    c.setFont("Helvetica", 7.5)
    c.setFillColor(HexColor("#6b7a8c"))
    c.drawString(L, 24, FOOTER)
    c.drawRightString(R, 24, f"{NAME}  |  Page 1")
    c.showPage()
    c.save()


def write_eml(pdf: Path, path: Path) -> None:
    msg = EmailMessage()
    msg["From"] = f"Sarah Thompson <{SENDER}>"
    msg["To"] = "orders@northernfoods.example"
    msg["Subject"] = f"Purchase Order {NAME} - FreshMart Markets [FICTIONAL SAMPLE]"
    msg["Date"] = format_datetime(RECEIVED)
    msg["Message-ID"] = f"<{NAME.lower()}@mapleretail.example>"
    msg["X-Demo-Notice"] = "Fictional sample email. Not sent over the internet."
    msg.set_content("Hello David,\n\nPlease find attached purchase order "
                    f"{NAME}. Please confirm receipt and expected ship date.\n\nThanks,\nSarah Thompson\n"
                    "Maple Retail Group Inc. (fictional sample)\n")
    msg.add_attachment(pdf.read_bytes(), maintype="application", subtype="pdf", filename=pdf.name)
    msg.set_boundary(f"sample-boundary-{NAME.lower()}")
    path.write_bytes(bytes(msg))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    pdf = OUT / f"{NAME}.pdf"
    write_pdf(pdf)
    eml = OUT / f"{NAME}.eml"
    write_eml(pdf, eml)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    shutil.copy(eml, PUBLIC / eml.name)
    print(f"Wrote {pdf.relative_to(ROOT)}, {eml.relative_to(ROOT)} and frontend/public/demo/{eml.name}")


if __name__ == "__main__":
    main()
