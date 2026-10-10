"""Document variants with ground truth for the accuracy benchmark (tests/bench.py).

Every variant is a different supplier template: title, label wording, field placement, column order, date and
number formats, currency, wrapped descriptions, decimal quantities, discount, freight, multi-page tables — plus
image degradations for scanned / photographed copies. Nothing here is tuned to one layout.
"""
from __future__ import annotations

import io
import math
import random
from dataclasses import dataclass, field, replace

import pymupdf
from PIL import Image, ImageEnhance, ImageFilter, ImageOps


@dataclass
class Item:
    desc: str
    sku: str
    qty: float
    price: float
    disc: float = 0.0  # line discount amount


@dataclass
class Spec:
    name: str
    title: str = "TAX INVOICE"
    doc_type: str = "tax_invoice"
    issuer: str = "Nova Optics Trading LLC"
    issuer_vat: str = "100345678900003"
    customer: str = "Lumina Cameras Pvt Ltd"
    customer_label: str = "Bill To"
    supplier_label: str = ""               # e.g. "From" / "Vendor" — printed as a section instead of a letterhead
    number: str = "INV-24-0815"
    number_label: str = "Invoice No"
    date_iso: str = "2026-03-14"
    date_fmt: str = "dmy/"                 # dmy/ dmy- ymd mdy/ dMy d-M-y
    date_label: str = "Date"
    currency: str = "AED"
    cur_style: str = "code"                # code | symbol | none
    num_style: str = "en"                  # en (1,250.00) | eu (1.250,00) | space (1 250.00) | plain (1250.00)
    layout: str = "std"                    # std | code_first | simple | qty_first | amount_tax
    items: list = field(default_factory=list)
    vat_pct: float = 5.0
    freight: float = 0.0
    header_discount: float = 0.0           # discount on the totals block
    total_label: str = "Grand Total"
    sub_label: str = "Subtotal"
    labels_right: bool = True              # number/date block on the right vs below title
    font: float = 9.0
    pages_items_split: int = 0             # >0: table continues on page 2 after N rows
    wrap: bool = False                     # long descriptions wrap onto a second line


DEFAULT_ITEMS = [
    Item("Sony FX3 Cinema Camera Body", "SNY-FX3", 2, 3899.00),
    Item("Godox V1 Round Head Flash", "GDX-V1", 10, 249.50),
    Item("Manfrotto 190 Carbon Tripod", "MAN-190CX", 5, 120.75),
]
LONG_ITEMS = [
    Item("Sigma 24-70mm F2.8 DG DN Art Lens for Sony E-mount with hood and caps", "SIG-2470E", 3, 1099.00),
    Item("SmallRig Cage Kit for Sony FX3 / FX30 with top handle and cable clamp", "SR-3277", 4, 189.90),
    Item("Atomos Ninja V+ 8K HDR monitor recorder", "ATO-NV8K", 1, 1299.00),
]
SYMBOLS = {"USD": "$", "EUR": "€", "GBP": "£", "INR": "Rs.", "AED": "AED"}


def fmt_num(v: float, style: str, decimals: int = 2) -> str:
    s = f"{v:,.{decimals}f}"
    if style == "eu":
        return s.replace(",", "§").replace(".", ",").replace("§", ".")
    if style == "space":
        return s.replace(",", " ")
    if style == "plain":
        return f"{v:.{decimals}f}"
    return s


def fmt_date(iso: str, f: str) -> str:
    y, m, d = (int(x) for x in iso.split("-"))
    mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]
    return {"dmy/": f"{d:02d}/{m:02d}/{y}", "dmy-": f"{d:02d}-{m:02d}-{y}", "ymd": iso, "mdy/": f"{m:02d}/{d:02d}/{y}",
            "dMy": f"{d:02d} {mon} {y}", "d-M-y": f"{d:02d}-{mon}-{y}"}[f]


def money(spec: Spec, v: float) -> str:
    n = fmt_num(v, spec.num_style)
    if spec.cur_style == "code":
        return f"{spec.currency} {n}"
    if spec.cur_style == "symbol":
        sym = SYMBOLS.get(spec.currency, spec.currency)
        return f"{sym}{n}" if sym in ("$", "€", "£") else f"{sym} {n}"
    return n


LAYOUTS = {
    "std": ["#", "Description", "SKU", "Qty", "Unit Price", "Disc", "VAT %", "VAT Amt", "Amount"],
    "code_first": ["Item Code", "Description", "Quantity", "Rate", "Amount"],
    "simple": ["Description", "Qty", "Unit Price", "Total"],
    "qty_first": ["Qty", "Product", "Code", "Price", "Line Total"],
    "amount_tax": ["Particulars", "Part No", "Qty", "Unit Price", "Discount", "Tax", "Amount"],
}
WIDTHS = {"#": 18, "Description": 175, "Particulars": 165, "Product": 165, "SKU": 70, "Item Code": 70, "Code": 70, "Part No": 70,
          "Qty": 34, "Quantity": 50, "Unit Price": 62, "Rate": 62, "Price": 62, "Disc": 40, "Discount": 52, "VAT %": 38,
          "VAT Amt": 52, "Tax": 46, "Amount": 66, "Total": 66, "Line Total": 66}


def build(spec: Spec) -> tuple[bytes, dict]:
    items = spec.items or DEFAULT_ITEMS
    doc = pymupdf.open()
    page = doc.new_page()
    fs = spec.font
    righty = 390 if spec.labels_right else 40

    def text(p, x, y, s, size=None, bold=False):
        p.insert_text((x, y), s, fontsize=size or fs, fontname="hebo" if bold else "helv")

    y = 48
    if spec.supplier_label:
        text(page, 40, y, spec.title, 16, True)
        y += 24
        text(page, 40, y, f"{spec.supplier_label}:", fs + 1, True); y += 12
        text(page, 40, y, spec.issuer, fs + 1); y += 11
        text(page, 40, y, "Plot 12, Jebel Ali Free Zone, Dubai", fs); y += 11
        text(page, 40, y, f"TRN: {spec.issuer_vat}", fs); y += 11
    else:
        text(page, 40, y, spec.issuer, 15, True); y += 15
        for ln in ["Plot 12, Jebel Ali Free Zone, Dubai, UAE", "Tel: +971 4 555 0100  Email: billing@novaoptics.example", f"TRN: {spec.issuer_vat}"]:
            text(page, 40, y, ln, fs - 1); y += 11
        text(page, 390 if spec.labels_right else 40, 50 if spec.labels_right else y + 14, spec.title, 16, True)
        if not spec.labels_right:
            y += 26
    ny = 70 if spec.labels_right else y + 4
    text(page, righty, ny, f"{spec.number_label}: {spec.number}", fs + 1)
    text(page, righty, ny + 13, f"{spec.date_label}: {fmt_date(spec.date_iso, spec.date_fmt)}", fs + 1)
    text(page, righty, ny + 26, "Payment Terms: 30 days", fs)
    y = max(y, ny + 26) + 22
    text(page, 40, y, f"{spec.customer_label}:", fs + 1, True); y += 12
    text(page, 40, y, spec.customer, fs + 1); y += 11
    text(page, 40, y, "22 MG Road, Bengaluru 560001, India", fs); y += 11
    text(page, 40, y, "GSTIN: 29ABCDE1234F1Z5", fs); y += 11
    text(page, 40, y, "Phone: +91 80 4000 1234", fs); y += 24

    cols = LAYOUTS[spec.layout]
    xs, x = [], 40
    for c in cols:
        xs.append((x, c)); x += WIDTHS[c]
    right = x

    def header(p, yy):
        p.draw_rect(pymupdf.Rect(40, yy - 11, right, yy + 4), color=(0, 0, 0), width=0.6)
        for cx, c in xs:
            text(p, cx + 2, yy, c, fs - 0.5, True)
        return yy + 8

    y = header(page, y)
    sub = disc_total = vat_total = 0.0
    truth_items = []
    cur = page
    for i, it in enumerate(items, 1):
        if spec.pages_items_split and i == spec.pages_items_split + 1:
            text(cur, 40, 800, "Continued on next page", fs - 1)
            cur = doc.new_page()
            y = header(cur, 60)
        gross = it.qty * it.price
        net = gross - it.disc
        vat = round(net * spec.vat_pct / 100, 2)
        amount_has_tax = spec.layout in ("std", "amount_tax")
        amount = round(net + vat, 2) if amount_has_tax else round(net, 2)
        sub += gross; disc_total += it.disc; vat_total += vat
        qty_s = f"{it.qty:g}" if it.qty != int(it.qty) else str(int(it.qty))
        desc = it.desc
        desc2 = ""
        if spec.wrap or len(desc) > 38:
            cut = desc[:38].rfind(" ")
            desc, desc2 = desc[:cut], desc[cut + 1:]
        vals = {"#": str(i), "Description": desc, "Particulars": desc, "Product": desc, "SKU": it.sku, "Item Code": it.sku, "Code": it.sku, "Part No": it.sku,
                "Qty": qty_s, "Quantity": qty_s, "Unit Price": fmt_num(it.price, spec.num_style), "Rate": fmt_num(it.price, spec.num_style),
                "Price": fmt_num(it.price, spec.num_style), "Disc": fmt_num(it.disc, spec.num_style), "Discount": fmt_num(it.disc, spec.num_style),
                "VAT %": f"{spec.vat_pct:g}", "VAT Amt": fmt_num(vat, spec.num_style), "Tax": fmt_num(vat, spec.num_style),
                "Amount": fmt_num(amount, spec.num_style), "Total": fmt_num(amount, spec.num_style), "Line Total": fmt_num(amount, spec.num_style)}
        y += 15
        for cx, c in xs:
            text(cur, cx + 2, y, vals[c], fs - 0.5)
        if desc2:
            y += 11
            dx = next(cx for cx, c in xs if c in ("Description", "Particulars", "Product"))
            text(cur, dx + 2, y, desc2, fs - 0.5)
        cur.draw_line((40, y + 4), (right, y + 4), color=(0.6, 0.6, 0.6), width=0.3)
        truth_items.append({"sku": it.sku if any(c in cols for c in ("SKU", "Item Code", "Code", "Part No")) else "", "qty": it.qty, "price": it.price, "desc": it.desc, "total": amount})
    y += 26
    discount = disc_total or spec.header_discount
    if spec.layout in ("std", "amount_tax"):
        tax_total = vat_total
    else:
        tax_total = round((sub - discount) * spec.vat_pct / 100, 2)
    grand = round(sub - discount + tax_total + spec.freight, 2)
    rows = [(spec.sub_label, sub)]
    if discount:
        rows.append(("Discount", discount))
    if spec.freight:
        rows.append(("Freight Charges", spec.freight))
    if spec.vat_pct:
        rows.append((f"VAT ({spec.vat_pct:g}%)", tax_total))
    rows.append((spec.total_label, grand))
    for label, v in rows:
        text(cur, 345, y, f"{label}:", fs + 0.5, label == spec.total_label)
        text(cur, 460, y, money(spec, v), fs + 0.5, label == spec.total_label)
        y += 13
    text(cur, 40, 812, "Bank: Emirates NBD  A/C 1015 4433 2299 01  IBAN AE07 0260 0010 1544 3322 9901", fs - 1.5)
    truth = {
        "doc_type": spec.doc_type, "number": spec.number, "date": spec.date_iso, "customer": spec.customer, "supplier": spec.issuer,
        "issuer_vat": spec.issuer_vat, "currency": spec.currency, "items": truth_items, "subtotal": round(sub, 2), "discount": round(discount, 2),
        "tax": round(tax_total, 2), "freight": spec.freight, "total": grand,
    }
    return doc.tobytes(), truth


# ── degradations (scanned / photographed copies) ────────────────────────────
def raster(pdf: bytes, dpi: int = 200, page_no: int = 0) -> Image.Image:
    d = pymupdf.open(stream=pdf, filetype="pdf")
    pm = d[page_no].get_pixmap(dpi=dpi, colorspace=pymupdf.csRGB)
    return Image.frombytes("RGB", (pm.width, pm.height), pm.samples)


def to_bytes(img: Image.Image, fmt: str = "JPEG", q: int = 85) -> bytes:
    b = io.BytesIO()
    img.save(b, fmt, quality=q) if fmt == "JPEG" else img.save(b, fmt)
    return b.getvalue()


def scan_pdf(pdf: bytes, transform=None, dpi: int = 200) -> bytes:
    src = pymupdf.open(stream=pdf, filetype="pdf")
    out = pymupdf.open()
    for i in range(len(src)):
        img = raster(pdf, dpi, i)
        if transform:
            img = transform(img)
        p = out.new_page(width=595, height=842)
        p.insert_image(p.rect, stream=to_bytes(img))
    return out.tobytes()


def phone_photo(img: Image.Image, seed: int = 3) -> Image.Image:
    """Uneven lighting, slight blur, small tilt, warm tint, JPEG artefacts."""
    rnd = random.Random(seed)
    w, h = img.size
    grad = Image.linear_gradient("L").resize((w, h)).point(lambda p: 150 + p * 0.4)
    img = Image.composite(img, Image.new("RGB", (w, h), (90, 80, 70)), grad)
    img = ImageEnhance.Color(img).enhance(0.8)
    img = img.filter(ImageFilter.GaussianBlur(0.8))
    img = img.rotate(rnd.uniform(-2.5, 2.5), resample=Image.BICUBIC, expand=True, fillcolor=(70, 65, 60))
    return img


def dark(img: Image.Image) -> Image.Image:
    return ImageEnhance.Brightness(ImageEnhance.Contrast(img).enhance(0.55)).enhance(0.55)


def noisy(img: Image.Image, amount: float = 0.03, seed: int = 1) -> Image.Image:
    rnd = random.Random(seed)
    g = img.convert("L")
    px = g.load()
    for _ in range(int(g.width * g.height * amount)):
        x, y = rnd.randrange(g.width), rnd.randrange(g.height)
        px[x, y] = rnd.choice((0, 255))
    return g.filter(ImageFilter.GaussianBlur(0.6))


def lowres(img: Image.Image, factor: float = 0.45) -> Image.Image:
    return img.resize((int(img.width * factor), int(img.height * factor)), Image.BILINEAR)


def tilt(img: Image.Image, deg: float) -> Image.Image:
    return img.rotate(deg, resample=Image.BICUBIC, expand=True, fillcolor=(255, 255, 255))


def rot90(img: Image.Image) -> Image.Image:
    return img.rotate(-90, expand=True)


# ── the benchmark set ───────────────────────────────────────────────────────
def corpus() -> list[tuple[str, bytes, str, dict]]:
    """(name, bytes, kind, truth)"""
    S = Spec
    specs = [
        S("clean_std_aed"),
        S("code_first_usd_symbol", layout="code_first", currency="USD", cur_style="symbol", number="QT-2026-118", title="QUOTATION", doc_type="quotation", number_label="Quotation No", date_fmt="dMy"),
        S("simple_inr_gst", layout="simple", currency="INR", cur_style="code", number="GST/24-25/0912", number_label="Invoice #", date_fmt="dmy-", vat_pct=18, freight=350.0),
        S("qty_first_eur_eu_numbers", layout="qty_first", currency="EUR", cur_style="code", num_style="eu", number="RE-77345", number_label="Inv No.", date_fmt="d-M-y", vat_pct=19, title="INVOICE", doc_type="invoice"),
        S("amount_tax_gbp_discount", layout="amount_tax", currency="GBP", cur_style="code", items=[Item("Sony FX3 Cinema Camera Body", "SNY-FX3", 2, 3899.00, 389.90), Item("Godox V1 Round Head Flash", "GDX-V1", 10, 249.50, 0.0), Item("Manfrotto 190 Carbon Tripod", "MAN-190CX", 5, 120.75, 30.19)], number="SI-2026/0042", number_label="Document No", date_label="Issue Date", vat_pct=20, total_label="Total Amount", title="SALES INVOICE", doc_type="invoice"),
        S("proforma_us_date", title="PROFORMA INVOICE", doc_type="proforma_invoice", number="PI-5521", number_label="Proforma No", date_fmt="mdy/", date_iso="2026-03-24", currency="USD", cur_style="code", layout="simple", header_discount=150.0, freight=95.0),
        S("purchase_from_vendor", title="PURCHASE INVOICE", doc_type="purchase_invoice", supplier_label="Vendor", customer_label="Bill To", customer="ARIB GLOBAL FZE", number="PO-INV-3381", number_label="Bill No", layout="code_first"),
        S("credit_note", title="CREDIT NOTE", doc_type="credit_note", number="CN-0098", number_label="Credit Note No", layout="simple", items=[Item("Return - Godox V1 Round Head Flash", "GDX-V1", 2, 249.50)]),
        S("delivery_sold_to", title="TAX INVOICE", customer_label="Sold To", number="TI/2026/7781", layout="std", items=LONG_ITEMS, wrap=True, freight=120.0),
        S("decimal_qty_space_numbers", layout="simple", num_style="space", items=[Item("Gaffer tape 48mm (per metre)", "GT-48", 12.5, 3.20), Item("HDMI cable 2.1 (per metre)", "HD-21", 7.5, 4.10), Item("Lens cleaning tissue box", "LCT-100", 6, 12.00)], number="INV-9921"),
        S("labels_below_small_font", labels_right=False, font=7.5, number="INV-24-1001", total_label="Net Total"),
        S("aliases_inv_hash_amount_due", number="A-55102", number_label="Inv #", date_label="Date of Invoice", total_label="Amount Due", customer_label="Customer", layout="code_first", currency="USD", cur_style="code"),
        S("aliases_bill_from_invoice_total", title="BILL", doc_type="purchase_bill", supplier_label="From", customer_label="To", customer="ARIB GLOBAL FZE", number="B-2026-311", number_label="Bill No.", total_label="Invoice Total", sub_label="Sub Total", layout="simple"),
        S("buyer_net_total_ymd", customer_label="Buyer", total_label="Net Total", date_fmt="ymd", number="2026/INV/00071", number_label="Invoice Number", layout="amount_tax", freight=60.0),
        # supplier purchase invoices with large amounts: thousands separators in each locale convention
        S("big_amounts_en", title="TAX INVOICE", issuer="Mitsumi Distribution FZCO", customer="ARIB GLOBAL FZE", number="MD-2026-004417", layout="code_first", currency="USD", cur_style="code", wrap=True,
          items=[Item("Sony Alpha A7 IV Mirrorless Camera Body", "ILCE-7M4/B", 120, 2398.00, 1200.00), Item("Sigma 24-70mm F2.8 DG DN Art Lens for Sony E", "A019-24-70-DGDN", 80, 1045.50), Item("Atomos Ninja V+ Monitor Recorder", "ATOMNJAV2-PLUS", 45, 1549.75)], vat_pct=5.0, freight=1250.0),
        S("big_amounts_eu", title="TAX INVOICE", issuer="Optica Iberica SL", customer="ARIB GLOBAL FZE", number="FA-2026-0912", layout="simple", currency="EUR", cur_style="code", num_style="eu", vat_pct=21,
          items=[Item("Canon EOS R5 Body", "EOSR5-BODY", 150, 3299.00), Item("Canon RF 70-200mm F2.8L IS USM", "RF70200-28L", 60, 2549.90), Item("Canon LP-E6NH Battery", "LP-E6NH", 400, 74.35)]),
        S("big_amounts_space", title="TAX INVOICE", issuer="Nordic Foto AB", customer="ARIB GLOBAL FZE", number="NF-33018", layout="amount_tax", currency="SEK", cur_style="code", num_style="space", vat_pct=25,
          items=[Item("Hasselblad X2D 100C", "X2D-100C", 25, 69900.00), Item("Hasselblad XCD 55V", "XCD-55V", 25, 24950.00, 12475.00)]),
        S("multipage_table", items=DEFAULT_ITEMS + [Item("Rode VideoMic NTG", "RODE-NTG", 3, 249.00), Item("SanDisk 256GB CFexpress B", "SD-CFE256", 6, 289.00), Item("Peak Design Slide Strap", "PD-SL", 4, 79.95)], pages_items_split=3, number="INV-24-1200"),
    ]
    out = []
    for sp in specs:
        pdf, truth = build(sp)
        out.append((f"{sp.name}.pdf", pdf, "pdf", truth))
    # scanned / photographed copies of a few templates
    base = {sp.name: build(sp) for sp in specs}
    pdf, t = base["clean_std_aed"]
    out.append(("scan_std.pdf", scan_pdf(pdf, lambda im: im.convert("L")), "pdf", t))
    out.append(("phone_photo_std.jpg", to_bytes(phone_photo(raster(pdf, 170))), "jpg", t))
    out.append(("low_quality_scan.jpg", to_bytes(noisy(raster(pdf, 200)), q=55), "jpg", t))
    out.append(("rotated90.png", to_bytes(rot90(raster(pdf, 200).convert("L")), "PNG"), "png", t))
    out.append(("skewed3deg.jpg", to_bytes(tilt(raster(pdf, 200), 3.0)), "jpg", t))
    out.append(("dark_background.jpg", to_bytes(dark(raster(pdf, 200))), "jpg", t))
    pdf2, t2 = base["labels_below_small_font"]
    out.append(("small_text_lowres.jpg", to_bytes(lowres(raster(pdf2, 200))), "jpg", t2))
    pdf3, t3 = base["code_first_usd_symbol"]
    out.append(("scan_code_first.pdf", scan_pdf(pdf3), "pdf", t3))
    pdf4, t4 = base["amount_tax_gbp_discount"]
    out.append(("scan_discount_gbp.jpg", to_bytes(raster(pdf4, 200)), "jpg", t4))
    pdf5, t5 = base["delivery_sold_to"]
    out.append(("scan_wrapped_desc.jpg", to_bytes(raster(pdf5, 200)), "jpg", t5))
    pdf6, t6 = base["multipage_table"]
    out.append(("scan_multipage.pdf", scan_pdf(pdf6), "pdf", t6))
    return out
