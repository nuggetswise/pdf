"""Generate the fictional Maple Retail Group purchase orders (PDF and forwarded .eml) for Northern Foods.

Two demo POs (milk, cheese) are served by the app from frontend/public/samples/. The rest are test fixtures in
fixtures/maple/tests/, one condition each, so a test proves one acceptance check. Every page says it is fictional.
Run: python3 scripts/maple_pos.py [--publish]   (needs reportlab only; --publish also copies the
two demo emails into frontend/public/samples/ for the app to serve)
"""
from __future__ import annotations

import shutil
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from email.message import EmailMessage
from email.utils import format_datetime
from pathlib import Path

from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import LETTER
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "fixtures" / "maple"
PUBLIC = ROOT / "frontend" / "public" / "samples"
SENDER = "procurement@mapleretail.example"
FOOTER = "Fictional sample purchase order for demonstration and testing. Not a real order."
MAPLE = ["Maple Retail Group Inc.", "Store Banner: FreshMart Markets", "Buyer Contact: Sarah Thompson",
         "procurement@mapleretail.example", "+1 614-555-0182"]
OTHER = ["Birchwood Test Market Ltd.", "Store Banner: Birchwood", "Buyer Contact: Test Buyer",
         "buying@birchwood-test.example", "+1 555-555-0100"]
TAX = Decimal("0.00")

NAVY = HexColor("#1b3350")
TEAL = HexColor("#2a6f97")
PALE = HexColor("#eef3f8")
RULE = HexColor("#c9d3de")


@dataclass
class Po:
    number: str
    file: str                       # file stem; differs from the number for a revision
    lines: list[tuple[str, str, str, str, str, str]]
    sent: datetime
    buyer: list[str] = field(default_factory=lambda: list(MAPLE))
    ship_to_id: str = "MAPLE-DC-01"
    freight: Decimal = Decimal("0.00")
    note: str = ""                  # one sentence in the email body


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


def write_pdf(spec: "Po", path: Path) -> None:
    c = canvas.Canvas(str(path), pagesize=LETTER, invariant=1)
    c.setTitle(f"Fictional sample purchase order {spec.number}")
    W, H = LETTER
    L, R = 42, W - 42
    c.setFillColor(NAVY)
    c.setFont("Helvetica-Bold", 26)
    c.drawString(L + 6, H - 80, "PURCHASE ORDER")
    c.setFont("Helvetica", 9.5)
    c.drawString(L + 6, H - 100, "Maple Retail Group Inc. | FreshMart Markets")
    c.setFont("Helvetica-Bold", 9.5)
    c.drawRightString(R - 6, H - 56, "PO NUMBER")
    c.drawRightString(R - 6, H - 69, spec.number)
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
        ("BUYER", spec.buyer),
        ("SUPPLIER", ["Northern Foods Manufacturing Inc.", "Supplier ID: SUP-100245", "Contact: David Chen",
                      "orders@northernfoods.example", "+1 312-555-0198"]),
        ("SHIP TO", ["FreshMart Distribution Center", "275 Logistics Parkway", "Columbus, OH 43217", "United States",
                     f"Ship-To ID: {spec.ship_to_id}"]),
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
    for line, sku, desc, uom, qty, price in spec.lines:
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
    total = merch + spec.freight + TAX
    y -= 18
    for lab, val in [("Merchandise Total", merch), ("Freight", spec.freight), ("Sales Tax", TAX)]:
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
    c.drawRightString(R, 24, f"{spec.number}  |  Page 1")
    c.showPage()
    c.save()


def write_eml(spec: Po, pdf: Path, path: Path) -> None:
    msg = EmailMessage()
    msg["From"] = f"Sarah Thompson <{SENDER}>"
    msg["To"] = "orders@northernfoods.example"
    msg["Subject"] = f"Purchase Order {spec.number} - FreshMart Markets [FICTIONAL SAMPLE]"
    msg["Date"] = format_datetime(spec.sent)
    msg["Message-ID"] = f"<{spec.file.lower()}@mapleretail.example>"
    msg["X-Sample-Notice"] = "Fictional sample email. Not sent over the internet."
    msg.set_content(f"Hello David,\n\nPlease find attached purchase order {spec.number}. "
                    f"{spec.note or 'Please confirm receipt and expected ship date.'}\n\nThanks,\nSarah Thompson\n"
                    "Maple Retail Group Inc. (fictional sample)\n")
    msg.add_attachment(pdf.read_bytes(), maintype="application", subtype="pdf", filename=pdf.name)
    msg.set_boundary(f"sample-boundary-{spec.file.lower()}")
    path.write_bytes(bytes(msg))


def at(day: int, hour: int = 9) -> datetime:
    return datetime(2026, 10, day, hour, 0, tzinfo=timezone.utc)


MILK1 = ("NF-MLK-001", "Whole Milk 1 L (case of 12)")
MILK2 = ("NF-MLK-002", "Semi-Skimmed Milk 1 L (case of 12)")
CHEDDAR = ("NF-CHS-001", "Cheddar Block 400 g (case of 12)")
MOZZA = ("NF-CHS-002", "Mozzarella 250 g (case of 12)")
CHEDDAR_RETIRED_GTIN = "614141200078"   # retired; replaced by NF-CHS-001's GTIN 614141200016

DEMO = [
    # Milk: every check passes.
    Po("PO-2026-104620", "PO-2026-104620", [
        ("1", MILK1[0], MILK1[1], "Case", "120", "18.00"),
        ("2", MILK2[0], MILK2[1], "Case", "100", "17.40")], at(15, 13), freight=Decimal("275.00")),
    # Cheese: Cheddar printed above the agreed price; Mozzarella short in ERP stock.
    Po("PO-2026-104633", "PO-2026-104633", [
        ("1", CHEDDAR[0], CHEDDAR[1], "Case", "60", "54.60"),
        ("2", MOZZA[0], MOZZA[1], "Case", "85", "38.40")], at(15, 14), freight=Decimal("275.00")),
]

TESTS = [
    # One condition each, so a test proves one acceptance check.
    Po("PO-2026-104701", "PO-2026-104701", [("1", MOZZA[0], MOZZA[1], "Case", "6", "38.40")], at(16, 8)),
    # Retired Cheddar GTIN, sent four times: held, held while the rule is only a candidate, reused once active,
    # held again once revoked.
    Po("PO-2026-104702", "PO-2026-104702", [("1", CHEDDAR_RETIRED_GTIN, CHEDDAR[1], "Case", "20", "52.80")], at(16, 9)),
    Po("PO-2026-104703", "PO-2026-104703", [("1", CHEDDAR_RETIRED_GTIN, CHEDDAR[1], "Case", "24", "52.80")], at(16, 10)),
    Po("PO-2026-104704", "PO-2026-104704", [("1", CHEDDAR_RETIRED_GTIN, CHEDDAR[1], "Case", "18", "52.80")], at(16, 11)),
    Po("PO-2026-104705", "PO-2026-104705", [("1", CHEDDAR_RETIRED_GTIN, CHEDDAR[1], "Case", "12", "52.80")], at(16, 12)),
    Po("PO-2026-104706", "PO-2026-104706", [("1", MILK1[0], "Whole Milk 1 L (each)", "EA", "120", "1.50")], at(16, 13)),
    # A buyer that is not on file, with the same retired GTIN: a rule approved for Maple must not apply to it.
    Po("PO-2026-104707", "PO-2026-104707", [("1", CHEDDAR_RETIRED_GTIN, CHEDDAR[1], "Case", "12", "52.80")], at(16, 14),
       buyer=OTHER, ship_to_id="BIRCH-DC-01"),
    # A ship-to code that is not on file for Maple.
    Po("PO-2026-104708", "PO-2026-104708", [("1", MILK2[0], MILK2[1], "Case", "40", "17.40")], at(16, 16), ship_to_id="MAPLE-DC-09"),
    # Mozzarella above ERP stock and nothing else: the intake test pack's stock-short case (TP-13).
    Po("PO-2026-104709", "PO-2026-104709", [("1", MOZZA[0], MOZZA[1], "Case", "85", "38.40")], at(16, 17)),
    Po("PO-2026-104620", "PO-2026-104620-r2", [
        ("1", MILK1[0], MILK1[1], "Case", "150", "18.00"),
        ("2", MILK2[0], MILK2[1], "Case", "100", "17.40")], at(16, 15), freight=Decimal("275.00"),
       note="Please replace the earlier PO of the same number. Line 1 is now 150 cases."),
]


def main() -> None:
    (OUT / "tests").mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    for folder, specs in (("", DEMO), ("tests", TESTS)):
        for spec in specs:
            d = OUT / folder if folder else OUT
            pdf = d / f"{spec.file}.pdf"
            write_pdf(spec, pdf)
            eml = d / f"{spec.file}.eml"
            write_eml(spec, pdf, eml)
            if not folder and "--publish" in sys.argv:
                shutil.copy(eml, PUBLIC / eml.name)
    print(f"Wrote {len(DEMO)} demo and {len(TESTS)} test POs under {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
