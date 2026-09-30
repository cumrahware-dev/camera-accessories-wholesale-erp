"""Generates realistic business documents (with ground truth) to test the real Tesseract pipeline."""
from __future__ import annotations

import io
import random

import pymupdf
from PIL import Image, ImageFilter

ITEMS = [
    ("Sony FX3 Cinema Camera Body", "SNY-FX3", 2, "PCS", 3899.00),
    ("Godox V1 Round Head Flash", "GDX-V1", 10, "PCS", 249.50),
    ("Manfrotto 190 Carbon Tripod", "MAN-190CX", 5, "PCS", 120.75),
]

COLS = {
    "std": [("Sl", 24), ("Description", 140), ("SKU", 76), ("Qty", 28), ("Unit", 30), ("Unit Price", 58), ("Disc", 36), ("VAT %", 36), ("VAT Amt", 48), ("Amount", 56)],
    "code_first": [("Item Code", 85), ("Description", 200), ("Qty", 38), ("Rate", 80), ("Amount", 90)],
    "simple": [("Description", 230), ("Qty", 50), ("Unit Price", 90), ("Amount", 90)],
}


def money(v: float) -> str:
    return f"{v:,.2f}"


def make_pdf(title="TAX INVOICE", number="INV-2026-00417", date="14/03/2026", issuer="ARIB GLOBAL FZE", customer="Lumina Cameras Pvt Ltd",
             layout="std", discount=0.0, freight=150.0, vat_pct=5.0, items=ITEMS, rich_header=True, paid=0.0, pages=1, fontsize=9.0,
             with_items=True, number_label="Invoice No", currency="USD", bill_label="Bill To", missing_number=False, missing_date=False) -> tuple[bytes, dict]:
    doc = pymupdf.open()
    page = doc.new_page()
    fs = fontsize
    y = 45

    def text(x, yy, s, size=None, bold=False):
        page.insert_text((x, yy), s, fontsize=size or fs, fontname="hebo" if bold else "helv")

    text(40, y, issuer, 15, True); y += 15
    if rich_header:
        for ln in ["Office 402, Business Bay, Dubai, United Arab Emirates", "Tel: +971 4 800 0100   Email: accounts@aribglobal.example",
                   "TRN: 100889218200001", "Corporate Tax Reg No: 100889218200003", "Trade Licence No: 1234567", "D-U-N-S Number: 65-432-1098"]:
            text(40, y, ln, fs - 1); y += 11
    text(380, 50, title, 16, True)
    if not missing_number:
        text(380, 68, f"{number_label}: {number}", fs + 1)
    if not missing_date:
        text(380, 81, f"Date: {date}", fs + 1)
    y = max(y, 130) + 12
    text(40, y, f"{bill_label}:", fs + 1, True); y += 12
    text(40, y, customer, fs + 1); y += 11
    text(40, y, "22 MG Road, Bengaluru, India", fs); y += 11
    text(40, y, "TRN: 200123456700003", fs); y += 11
    text(40, y, "Contact: buyer@lumina.example", fs); y += 24

    truth = {"number": None if missing_number else number, "issuer": issuer, "customer": customer, "items": []}
    if with_items:
        cols = COLS[layout]
        x = 40
        xs = []
        for name, w in cols:
            xs.append((x, w, name)); x += w
        page.draw_rect(pymupdf.Rect(40, y - 11, x, y + 4), color=(0, 0, 0), width=0.6)
        for cx, w, name in xs:
            text(cx + 2, y, name, fs - 0.5, True)
        y += 8
        sub = disc_total = vat_total = 0.0
        for i, (desc, sku, qty, unit, price) in enumerate(items, 1):
            gross = qty * price
            line_disc = round(gross * discount / 100, 2) if discount else 0.0
            net = gross - line_disc
            vat = round(net * vat_pct / 100, 2)
            amount = round(net + vat, 2) if layout == "std" else gross
            sub += gross; disc_total += line_disc; vat_total += vat
            y += 15
            vals = {"Sl": str(i), "Description": desc, "SKU": sku, "Item Code": sku, "Qty": str(qty), "Unit": unit, "Unit Price": money(price), "Rate": money(price),
                    "Disc": money(line_disc), "VAT %": f"{vat_pct:g}", "VAT Amt": money(vat), "Amount": money(amount)}
            for cx, w, name in xs:
                text(cx + 2, y, vals.get(name, ""), fs - 0.5)
            page.draw_line((40, y + 4), (x, y + 4), color=(0.6, 0.6, 0.6), width=0.3)
            truth["items"].append({"sku": sku, "qty": qty, "price": price, "desc": desc})
        y += 26
        if layout == "std":
            vat_total_line = vat_total
            grand = round(sub - disc_total + vat_total_line + freight, 2)
        else:
            vat_total_line = round((sub - discount) * vat_pct / 100, 2) if vat_pct else 0.0
            grand = round(sub - discount + vat_total_line + freight, 2)
        rows = [("Subtotal", sub)]
        if discount and layout != "std":
            rows.append(("Discount", discount))
        elif discount:
            rows.append(("Discount", disc_total))
        if freight:
            rows.append(("Freight", freight))
        if vat_pct:
            rows.append((f"VAT ({vat_pct:g}%)", vat_total_line))
        rows.append(("Grand Total", grand))
        if paid:
            rows.append(("Amount Paid", paid)); rows.append(("Balance Due", round(grand - paid, 2)))
        for label, v in rows:
            text(360, y, f"{label}:", fs + 0.5, label == "Grand Total")
            text(455, y, f"{currency} {money(v)}", fs + 0.5, label == "Grand Total")
            y += 13
        truth.update(subtotal=round(sub, 2), total=grand, freight=freight, vat=round(vat_total_line, 2), currency=currency, paid=paid)
    text(40, 800, "This is a computer generated document.", fs - 1)
    for _ in range(pages - 1):
        p2 = doc.new_page()
        p2.insert_text((40, 60), "Terms and conditions apply. Goods once sold are not returnable.", fontsize=fs)
    return doc.tobytes(), truth


def rasterize(pdf: bytes, dpi=200, page_no=0) -> Image.Image:
    d = pymupdf.open(stream=pdf, filetype="pdf")
    pm = d[page_no].get_pixmap(dpi=dpi, colorspace=pymupdf.csRGB)
    return Image.frombytes("RGB", (pm.width, pm.height), pm.samples)


def scan_pdf(pdf: bytes, dpi=200, jpeg_quality=None, transform=None, pages=None) -> bytes:
    """PDF of page images only (no text layer), optionally degraded."""
    src = pymupdf.open(stream=pdf, filetype="pdf")
    out = pymupdf.open()
    for i in range(len(src) if pages is None else pages):
        img = rasterize(pdf, dpi, i)
        if transform:
            img = transform(img)
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=jpeg_quality or 90)
        p = out.new_page(width=595, height=842)
        p.insert_image(p.rect, stream=buf.getvalue())
    return out.tobytes()


def to_png(img: Image.Image) -> bytes:
    b = io.BytesIO(); img.save(b, "PNG"); return b.getvalue()


def to_jpg(img: Image.Image, q=80) -> bytes:
    b = io.BytesIO(); img.save(b, "JPEG", quality=q); return b.getvalue()


def degrade_noise(img: Image.Image, seed=1, amount=0.02) -> Image.Image:
    rnd = random.Random(seed)
    g = img.convert("L")
    px = g.load()
    w, h = g.size
    for _ in range(int(w * h * amount)):
        px[rnd.randrange(w), rnd.randrange(h)] = rnd.choice((0, 255))
    return g.filter(ImageFilter.GaussianBlur(0.8)).convert("RGB")


def rotate(img: Image.Image, deg: float) -> Image.Image:
    return img.rotate(deg, expand=True, fillcolor=(255, 255, 255), resample=Image.BICUBIC)


def low_res(img: Image.Image, factor=0.5) -> Image.Image:
    return img.resize((int(img.width * factor), int(img.height * factor)), Image.BILINEAR)
