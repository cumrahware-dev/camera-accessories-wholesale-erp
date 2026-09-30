"""
Structured invoice/proforma extraction from OCR lines.

Rules: never invent a value. Anything not found stays empty/0 and is listed in
`review_fields`; arithmetic inconsistencies are reported in `warnings`, never silently fixed.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from .reader import ReadResult

LOW_CONF = 0.85
MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
CURRENCIES = ["USD", "AED", "INR", "EUR", "GBP", "SAR", "CNY", "JPY", "SGD", "HKD", "AUD", "CAD", "CHF", "QAR", "KWD", "OMR", "BHD"]
NUM = r"-?\d[\d.,]*"


@dataclass
class Row:
    text: str
    conf: float
    page: int


def to_rows(result: ReadResult) -> list[Row]:
    rows: list[Row] = []
    for pg in result.pages:
        lines = sorted(pg.lines, key=lambda l: (l.y0 + l.y1) / 2)
        groups: list[list] = []
        for l in lines:
            cy = (l.y0 + l.y1) / 2
            if groups:
                g = groups[-1]
                gy = sum((x.y0 + x.y1) / 2 for x in g) / len(g)
                gh = sum(x.y1 - x.y0 for x in g) / len(g)
                if abs(cy - gy) < max(gh, l.y1 - l.y0) * 0.5:
                    g.append(l)
                    continue
            groups.append([l])
        for g in groups:
            g.sort(key=lambda l: l.x0)
            rows.append(Row("  ".join(x.text.strip() for x in g), min(x.conf for x in g), pg.page))
    return rows


def parse_amount(raw: str) -> float | None:
    s = re.sub(r"[^\d.,\-\s]", "", raw).strip()
    s = re.sub(r"\s+", "", s)
    if not re.search(r"\d", s):
        return None
    neg = s.startswith("-")
    s = s.replace("-", "")
    dot, comma = s.rfind("."), s.rfind(",")
    if dot >= 0 and comma >= 0:
        s = s.replace(".", "").replace(",", ".") if comma > dot else s.replace(",", "")
    elif comma >= 0:
        s = s.replace(",", ".") if re.search(r",\d{2}$", s) and not re.search(r",\d{3}$", s) else s.replace(",", "")
    try:
        n = float(s)
    except ValueError:
        return None
    return -n if neg else n


def _fmt(y: int, mo: int, d: int) -> str | None:
    return f"{y}-{mo:02d}-{d:02d}" if 1 <= mo <= 12 and 1 <= d <= 31 else None


def parse_date(raw: str) -> tuple[str, bool] | None:
    """Returns (ISO date, ambiguous_day_month_order)."""
    m = re.search(r"\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b", raw)
    if m:
        iso = _fmt(int(m[1]), int(m[2]), int(m[3]))
        return (iso, False) if iso else None
    m = re.search(r"\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b", raw)
    if m:
        y = int(m[3]) + (2000 if int(m[3]) < 100 else 0)
        a, b = int(m[1]), int(m[2])
        iso = _fmt(y, b, a)  # day-first (UAE / India convention)
        return (iso, a <= 12 and b <= 12 and a != b) if iso else None
    m = re.search(r"\b(\d{1,2})(?:st|nd|rd|th)?[\s\-,]+([A-Za-z]{3,9})\.?[\s\-,]+(\d{4})\b", raw)
    if m and m[2][:3].lower() in MONTHS:
        iso = _fmt(int(m[3]), MONTHS.index(m[2][:3].lower()) + 1, int(m[1]))
        return (iso, False) if iso else None
    m = re.search(r"\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b", raw)
    if m and m[1][:3].lower() in MONTHS:
        iso = _fmt(int(m[3]), MONTHS.index(m[1][:3].lower()) + 1, int(m[2]))
        return (iso, False) if iso else None
    return None


def detect_currency(text: str) -> str:
    up = text.upper()
    counts = sorted(((len(re.findall(rf"\b{c}\b", up)), c) for c in CURRENCIES), reverse=True)
    if counts[0][0] > 0:
        return counts[0][1]
    if re.search(r"₹|\bRS\.?\b", text, re.I):
        return "INR"
    if "€" in text:
        return "EUR"
    if "£" in text:
        return "GBP"
    if re.search(r"\bDHS?\b", text, re.I):
        return "AED"
    if "$" in text:
        return "USD"
    return ""


def labelled(rows: list[Row], label: str, exclude: str | None = None):
    lab = re.compile(label, re.I)
    exc = re.compile(exclude, re.I) if exclude else None
    for r in reversed(rows):
        if not lab.search(r.text) or (exc and exc.search(r.text)):
            continue
        after = lab.split(r.text, maxsplit=1)[-1] if lab.search(r.text) else ""
        nums = re.findall(NUM, after)
        if not nums:
            continue
        v = parse_amount(nums[-1])
        if v is not None:
            return v, r.conf
    return None


TOTALS_RE = re.compile(r"^\s*(sub\s*-?\s*total|total|grand\s*total|net\s*total|vat|gst|tax|freight|shipping|discount|amount\s*due|balance|round)", re.I)
HEADER_RE = re.compile(r"(description|item|product|particulars).*(qty|quantity|pcs|nos)", re.I)
COLS = [("qty", r"qty|quantity|pcs|nos"), ("unit", r"unit\s*price|rate|price"), ("disc", r"disc\w*"), ("tax", r"vat|gst|tax"), ("amount", r"amount|total|value")]


def header_columns(header: str) -> list[str]:
    """Order of numeric columns as they appear in the table header (e.g. qty, unit, disc, tax, amount)."""
    found = []
    for key, pat in COLS:
        m = re.search(pat, header, re.I)
        if m:
            found.append((m.start(), key))
    return [k for _, k in sorted(found)]


def parse_item_row(text: str, idx: int, conf: float, cols: list[str]):
    clean = re.sub(r"\b(USD|AED|INR|EUR|GBP)\b|[$€£₹]|%", " ", text, flags=re.I)
    clean = re.sub(r"\s{2,}", "  ", clean).strip()
    matches = list(re.finditer(r"(?<![A-Za-z0-9\-])-?\d[\d.,]*(?![A-Za-z0-9\-])", clean))
    if len(matches) < 3:
        return None
    n = len(cols) if len(cols) >= 3 and len(matches) >= len(cols) else 3
    use_cols = cols if n == len(cols) else ["qty", "unit", "amount"]
    tail = matches[-n:]
    vals = {k: parse_amount(m[0]) for k, m in zip(use_cols, tail)}
    qty, unit, amt = vals.get("qty"), vals.get("unit"), vals.get("amount")
    if qty is None or unit is None or amt is None or qty <= 0 or qty != int(qty):
        return None
    head = clean[: tail[0].start()].strip()
    if len(head) < 2:
        return None
    tokens = re.split(r"\s+", head)
    sku = ""
    if len(tokens) > 1 and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9\-_./]{2,}", tokens[-1]) and re.search(r"\d|-", tokens[-1]):
        sku = tokens.pop()
    desc = " ".join(tokens).strip()
    if not desc:
        return None
    disc, tax = vals.get("disc") or 0.0, vals.get("tax") or 0.0
    gross = qty * unit
    # amount may be net of discount and/or include tax; accept any consistent reading
    ok_vals = {gross, gross - disc, gross - disc + tax, gross + tax}
    consistent = any(abs(v - amt) <= max(0.02, abs(amt) * 0.005) for v in ok_vals)
    return {
        "description": desc,
        "sku": sku,
        "quantity": int(qty),
        "unit_price": unit,
        "discount": disc,
        "tax": tax,
        "total": amt,
    }, (consistent and conf >= LOW_CONF)


def extract_invoice(result: ReadResult, file_name: str = "") -> dict:
    rows = to_rows(result)
    full = "\n".join(r.text for r in rows)
    review: list[str] = []
    warnings: list[str] = []
    fconf: dict[str, float] = {}
    used_ocr = any(p.source == "ocr" for p in result.pages)

    def flag(field: str, conf: float | None = None):
        if conf is not None:
            fconf[field] = round(conf, 3)
        if (conf is None or conf < LOW_CONF) and field not in review:
            review.append(field)

    def need(field: str):
        if field not in review:
            review.append(field)

    # document type
    hay = f"{full[:600]} {file_name}".lower()
    if re.search(r"pro\s*-?forma|quotation|\bquote\b", hay):
        doc_type = "proforma"
    elif re.search(r"tax\s+invoice|commercial\s+invoice|\binvoice\b", hay):
        doc_type = "invoice"
    elif re.search(r"purchase\s+order", hay):
        doc_type = "purchase_order"
    else:
        doc_type = "other"
        need("document_type")

    # number
    number, nconf = "", 0.0
    no_re = re.compile(r"\b(?:invoice|inv|pro\s*-?forma|quotation|quote|pi)\b\s*(?:no\.?|number|num|#|id)\s*[:.#\-]?\s*([A-Z0-9][A-Z0-9\-/_.]{2,})|\b(?:invoice|pro\s*-?forma|quotation|quote)\b\s*:\s*([A-Z0-9][A-Z0-9\-/_.]{2,})", re.I)
    for r in rows[:40]:
        for x in no_re.finditer(r.text):
            cand = x[1] or x[2]
            if re.search(r"\d", cand) and not re.match(r"(date|total)", cand, re.I):
                number, nconf = cand.rstrip(".,"), r.conf
                break
        if number:
            break
    flag("invoice_number", nconf if number else None)
    if used_ocr and number:
        need("invoice_number")

    # dates
    inv_date = due_date = ""
    for r in rows:
        d = parse_date(r.text)
        if not d:
            continue
        iso, amb = d
        if re.search(r"due|payment\s*date|valid|expir", r.text, re.I):
            due_date = due_date or iso
        elif not inv_date:
            inv_date = iso
            flag("invoice_date", 0.5 if amb else r.conf)
            if amb:
                warnings.append("The invoice date was read as day/month/year - please confirm.")
    if not inv_date:
        flag("invoice_date")

    currency = detect_currency(full)
    if not currency:
        need("currency")

    def party(label: str):
        rx = re.compile(label, re.I)
        i = next((k for k, r in enumerate(rows) if rx.search(r.text)), -1)
        if i < 0:
            return None
        inline = re.sub(r"^[\s:.\-]+", "", rx.sub("", rows[i].text, count=1)).strip()
        lines = [Row(inline, rows[i].conf, rows[i].page)] if inline else []
        for j in range(i + 1, len(rows)):
            if len(lines) >= 4:
                break
            t = rows[j].text
            if not t.strip() or re.match(r"(description|item|s\.?no|sl)\b", t, re.I) or parse_date(t) or re.search(r"(invoice|date|due|ship\s*to|phone|tel|email)\s*[:#]", t, re.I):
                break
            lines.append(rows[j])
        if not lines:
            return None
        return {
            "name": re.split(r"\s{2,}", lines[0].text)[0].strip(),
            "address": ", ".join(re.split(r"\s{2,}", l.text)[0] for l in lines[1:]),
            "conf": min(l.conf for l in lines),
        }

    bill = party(r"\b(bill(?:ed)?\s*to|sold\s*to|customer|buyer|consignee|client)\b\s*[:.]?")
    ship = party(r"\bship(?:ped)?\s*to\b\s*[:.]?")
    frm = party(r"\b(from|seller|vendor|supplier|exporter)\b\s*[:.]?")
    customer = bill["name"] if bill else ""
    flag("customer_name", bill["conf"] if bill else None)
    supplier = frm["name"] if frm else ""
    if frm:
        flag("supplier_name", frm["conf"])
    else:
        guess = None
        for r in [x for x in rows if x.page == 1][:6]:
            cell = re.split(r"\s{2,}", r.text)[0].strip()
            if re.search(r"[A-Za-z]{3}", cell) and not cell.endswith(":") and not re.match(r"(tax\s+)?invoice|pro\s*-?forma|quotation|date|page", cell, re.I):
                guess = (cell, r.conf)
                break
        if guess:
            supplier = guess[0]
            flag("supplier_name", min(guess[1], 0.6))  # a header guess: always review
        else:
            flag("supplier_name")

    email = (re.search(r"[\w.+-]+@[\w-]+\.[\w.-]+", full) or [""])[0]
    m = re.search(r"(?:tel|phone|mob|ph)[^\d+]{0,10}(\+?\d[\d\s().-]{7,17}\d)", full, re.I)
    phone = m[1].strip() if m else ""
    m = re.search(r"(?:TRN|VAT|GSTIN|GST|Tax\s*(?:Reg\w*|ID|No\.?))[^A-Za-z0-9]{0,12}([A-Z0-9][A-Z0-9\-]{7,19})", full, re.I)
    vat_number = m[1] if m else ""
    m = re.search(r"(?:payment\s*terms?|terms)\s*[:\-]\s*(.+)", full, re.I)
    terms = m[1].strip() if m else ""

    # line items
    items, uncertain = [], 0
    hi = next((k for k, r in enumerate(rows) if HEADER_RE.search(r.text)), -1)
    cols = header_columns(rows[hi].text) if hi >= 0 else []
    for i in range(hi + 1 if hi >= 0 else 0, len(rows)):
        t = rows[i].text
        if TOTALS_RE.match(t):
            if items:
                break
            continue
        if HEADER_RE.search(t):
            continue
        p = parse_item_row(t, len(items), rows[i].conf, cols)
        if not p:
            continue
        item, ok = p
        uncertain += 0 if ok else 1
        items.append(item)
    if not items:
        need("line_items")
        warnings.append("No line items could be read. Enter them manually.")
    else:
        fconf["line_items"] = 0.5 if uncertain else 1.0
        if uncertain:
            need("line_items")
            warnings.append(f"{uncertain} line item(s) have low OCR confidence or quantity x price does not match the total - verify against the original.")

    # totals
    sub = labelled(rows, r"sub\s*-?\s*total")
    grand = labelled(rows, r"(grand\s*total|total\s*amount|amount\s*due|balance\s*due|invoice\s*total|net\s*total|^\s*total\b)", r"sub\s*-?\s*total|total\s*(qty|quantity|weight|pcs)")
    tax = labelled(rows, r"\b(?:vat|gst|igst|cgst|sgst|tax)\b(?:[^\d\n]*?\d+(?:\.\d+)?\s*%\)?)?", r"tax\s*invoice")
    freight = labelled(rows, r"(freight|shipping|delivery|courier)(?:\s*(?:charges?|cost|fee))?")
    disc = labelled(rows, r"discount(?:\s*amount)?")
    other = labelled(rows, r"(other\s*charges?|handling|packing|insurance|misc\w*)")
    val = lambda t: t[0] if t else 0.0
    totals = {
        "subtotal": val(sub), "discount": abs(val(disc)), "tax": val(tax),
        "freight": val(freight), "other_charges": val(other), "total": val(grand),
    }
    flag("subtotal", sub[1] if sub else None)
    flag("total", grand[1] if grand else None)
    for name, t in (("tax", tax), ("freight", freight), ("discount", disc), ("other_charges", other)):
        if t:
            flag(name, t[1])
    if used_ocr:
        need("total")
        if sub:
            need("subtotal")

    rnd = lambda n: round(n * 100) / 100
    items_sum = rnd(sum(i["total"] for i in items))
    tax_sum = rnd(sum(i["tax"] for i in items))
    disc_sum = rnd(sum(i["discount"] for i in items))
    # A line "total" may be gross, net of discount, and/or tax-inclusive: accept any consistent reading.
    readings = {items_sum, rnd(items_sum - tax_sum), rnd(items_sum - tax_sum + disc_sum), rnd(items_sum + disc_sum)}
    if items and sub and all(abs(r - sub[0]) > 0.05 for r in readings):
        need("subtotal"); need("line_items")
        warnings.append(f"Line items add up to {items_sum:.2f} but the document subtotal reads {sub[0]:.2f}.")
    if not sub and items:
        totals["subtotal"] = items_sum
        need("subtotal")
        warnings.append("Subtotal was not found; it was calculated from line items.")
    if grand:
        expected = rnd(totals["subtotal"] + totals["tax"] + totals["freight"] + totals["other_charges"] - totals["discount"])
        if totals["subtotal"] and abs(expected - grand[0]) > 0.05:
            need("total")
            warnings.append(f"Subtotal + tax + freight + other - discount = {expected:.2f} but the document total reads {grand[0]:.2f}.")
    else:
        warnings.append("Grand total was not found.")

    if not rows:
        warnings.append("No text could be read from this file.")
    if result.truncated:
        warnings.append("Only the first pages were processed.")
    confs = [r.conf for r in rows]
    return {
        "document_type": doc_type,
        "confidence": round(sum(confs) / len(confs), 3) if confs else 0.0,
        "data": {
            "invoice_number": number, "invoice_date": inv_date, "due_date": due_date,
            "customer_name": customer, "supplier_name": supplier, "vat_number": vat_number,
            "currency": currency, "payment_terms": terms, "email": email, "phone": phone,
            "billing_address": bill["address"] if bill else "",
            "shipping_address": ", ".join(x for x in ((ship or {}).get("name"), (ship or {}).get("address")) if x),
            **totals, "line_items": items,
        },
        "review_fields": review,
        "field_confidence": fconf,
        "warnings": warnings,
        "page_count": result.page_count,
        "is_scanned": used_ocr,
    }
