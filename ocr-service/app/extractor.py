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
    conf: float          # weakest cell on the row
    page: int
    mean: float = 1.0    # average over the row's cells


def to_rows(result: ReadResult) -> list[Row]:
    rows: list[Row] = []
    for pg in result.pages:
        # Cells with no letters or digits (".", "|", table-border debris) are OCR noise: they must not drag a row's confidence down.
        lines = sorted((l for l in pg.lines if re.search(r"[A-Za-z0-9]", l.text)), key=lambda l: (l.y0 + l.y1) / 2)
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
            rows.append(Row("  ".join(x.text.strip() for x in g), min(x.conf for x in g), pg.page, sum(x.conf for x in g) / len(g)))
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
    """Amount printed after a label on the same row. Returns (value, confidence, page) or None."""
    lab = re.compile(label, re.I)
    exc = re.compile(exclude, re.I) if exclude else None
    for r in reversed(rows):
        if not lab.search(r.text) or (exc and exc.search(r.text)):
            continue
        after = lab.split(r.text, maxsplit=1)[-1]
        nums = re.findall(NUM, after)
        if not nums:
            continue
        v = parse_amount(nums[-1])
        if v is not None:
            return v, r.conf, r.page
    return None


def level(conf: float | None) -> str:
    if conf is None:
        return "none"
    return "high" if conf >= 0.85 else "medium" if conf >= 0.6 else "low"



TOTALS_RE = re.compile(r"^\s*(sub\s*-?\s*total|total|grand\s*total|net\s*total|vat|gst|tax|freight|shipping|discount|amount\s*due|balance|round|amount\s*paid|paid)", re.I)
QTY_WORD = r"\b[a-z]ty\b|quantity|\bpcs\b|\bnos\b"   # tolerates the common OCR slip "Qty" -> "aty"
_HDR_GROUPS = [
    r"description|particulars|goods|\bitem\b|product",
    r"\bsku\b|item\s*code|product\s*code|part\s*(?:no|number)|\bmodel\b|\bcode\b",
    QTY_WORD,
    r"unit\s*price|\brate\b|\bprice\b",
    r"disc\w*",
    r"vat|gst|\btax\b",
    r"\bamount\b|line\s*total|\btotal\b|\bvalue\b",
]


class _Header:
    """A table header row is any row that names at least three different column types."""

    def search(self, text: str):
        if ":" in text and not re.search(r"qty|quantity", text, re.I):
            return None
        hits = sum(1 for g in _HDR_GROUPS if re.search(g, text, re.I))
        return True if hits >= 3 and re.search(_HDR_GROUPS[0] + "|" + _HDR_GROUPS[1], text, re.I) else None


HEADER_RE = _Header()

# Column vocabulary. Order in the header defines order in the rows: nothing is assumed about layout.
COLS = [
    ("taxpct", r"(?:vat|gst|tax) ?(?:%|rate)|% ?(?:vat|gst|tax)"),
    ("tax", r"(?:vat|gst|tax) (?:amount|amt)\b|(?:vat|gst|tax)(?! ?(?:%|rate|invoice))"),
    ("qty", QTY_WORD),
    ("unit", r"unit\s*price|\brate\b|\bprice\b"),
    ("disc", r"disc\w*"),
    ("amount", r"\bamount\b|line\s*total|\btotal\b|\bvalue\b"),
]
SKU_HDR = re.compile(r"\b(sku|item\s*code|product\s*code|part\s*(?:no|number)|model|code)\b", re.I)
DESC_HDR = re.compile(r"description|item\b(?!\s*code)|product\b(?!\s*code)|particulars|goods", re.I)
UNIT_WORDS = {"pcs", "pc", "nos", "no", "ea", "each", "set", "sets", "box", "boxes", "pack", "pkt", "kg", "g", "m", "mtr", "ltr", "l", "unit", "units", "pair", "pairs", "roll", "carton", "ctn"}


def header_layout(header: str) -> tuple[list[str], bool, bool]:
    """(ordered numeric columns, sku_column_before_description, has_sku_column)"""
    claimed: list[tuple[int, int]] = []
    found: list[tuple[int, str]] = []
    for key, pat in COLS:
        for m in re.finditer(pat, header, re.I):
            if any(s <= m.start() < e for s, e in claimed):
                continue
            claimed.append((m.start(), m.end()))
            found.append((m.start(), key))
            break
    cols = [k for _, k in sorted(found)]
    sku = SKU_HDR.search(header)
    desc = DESC_HDR.search(header)
    return cols, bool(sku and desc and sku.start() < desc.start()), bool(sku)


def parse_item_row(text: str, conf: float, cols: list[str], sku_first: bool, has_sku_col: bool = False):
    clean = re.sub(r"\b(USD|AED|INR|EUR|GBP)\b|[$€£₹]|%", " ", text, flags=re.I)
    clean = re.sub(r"(?<=\s)[_=|~`'\"\u2014\u2013\-.:;]{1,2}(?=\s)", " ", clean)  # stray glyphs from table borders
    clean = re.sub(r"\s{2,}", "  ", clean).strip()
    matches = list(re.finditer(r"(?<![A-Za-z0-9\-])-?\d[\d.,]*(?![A-Za-z0-9\-])", clean))
    if len(matches) < 3:
        return None
    n = len(cols) if len(cols) >= 3 and len(matches) >= len(cols) and "qty" in cols else 3
    use = cols if n == len(cols) else ["qty", "unit", "amount"]
    tail = matches[-n:]
    vals = {k: parse_amount(m[0]) for k, m in zip(use, tail)}
    qty, unit_price, amt = vals.get("qty"), vals.get("unit"), vals.get("amount")
    if qty is None or unit_price is None or amt is None or qty <= 0 or qty != int(qty):
        return None
    qty_m = tail[use.index("qty")]
    head = clean[: tail[0].start()].strip()
    unit = ""
    # a unit-of-measure word right after the quantity ("2 PCS 3,899.00 ...")
    between = clean[qty_m.end(): tail[use.index("qty") + 1].start()] if use.index("qty") + 1 < len(tail) else ""
    w = between.strip().lower().rstrip(".")
    if w in UNIT_WORDS:
        unit = between.strip()
    if len(head) < 2:
        return None
    tokens = re.split(r"\s+", head)

    def looks_code(t: str) -> bool:
        return bool(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9\-_./]{2,}", t) and re.search(r"\d|-", t))

    sku = ""
    if len(tokens) > 1:
        if sku_first and looks_code(tokens[0]):
            sku = tokens.pop(0)
        elif looks_code(tokens[-1]):
            sku = tokens.pop()
    desc = " ".join(tokens).strip()
    if not desc:
        return None
    disc, tax = vals.get("disc") or 0.0, vals.get("tax") or 0.0
    rate = vals.get("taxpct")
    gross = qty * unit_price
    ok_vals = {gross, gross - disc, gross - disc + tax, gross + tax}
    consistent = any(abs(v - amt) <= max(0.02, abs(amt) * 0.005) for v in ok_vals)
    if has_sku_col and not sku:
        consistent = False  # the table has a SKU column but none was read for this row: make the user look
    if rate is None:
        base = gross - disc
        rate = round(tax / base * 100, 2) if tax > 0 and base > 0 else 0.0
    elif tax == 0 and rate > 0:
        tax = round((gross - disc) * rate / 100, 2)
    return {
        "description": desc, "sku": sku, "quantity": int(qty), "unit": unit, "unit_price": unit_price,
        "discount": disc, "tax_rate": rate, "tax": tax, "total": amt,
    }, consistent, conf



TYPE_RULES = {
    "tax_invoice": [(r"tax\s+invoice", 3.0)],
    "proforma_invoice": [(r"pro\s*-?forma", 3.0)],
    "quotation": [(r"quotation|\bquote\b|\bestimate\b", 3.0)],
    "credit_note": [(r"credit\s+(?:note|memo)", 3.0)],
    "debit_note": [(r"debit\s+(?:note|memo)", 3.0)],
    "delivery_note": [(r"delivery\s+(?:note|challan)|goods\s+delivery|dispatch\s+note", 3.0)],
    "purchase_invoice": [(r"purchase\s+invoice|supplier\s+invoice|vendor\s+invoice", 3.0)],
    "purchase_bill": [(r"(?<!bill to)\bbill\b(?!\s*(?:to|ed))", 1.5), (r"vendor\s+bill|supplier\s+bill|purchase\s+bill", 3.0)],
    "invoice": [(r"\binvoice\b", 1.5), (r"commercial\s+invoice", 1.0)],
}


def detect_type(text: str, ocr_conf: float) -> tuple[str, float, dict]:
    t = text.lower()
    scores = {k: sum(w for pat, w in rules if re.search(pat, t)) for k, rules in TYPE_RULES.items()}
    specific = {k: v for k, v in scores.items() if k != "invoice" and v > 0}
    if specific:
        scores["invoice"] = 0.0  # a generic "invoice" word must not compete with a specific title
    ranked = sorted(((v, k) for k, v in scores.items() if v > 0), reverse=True)
    if not ranked:
        return "other", 0.3, scores
    top, key = ranked[0]
    second = ranked[1][0] if len(ranked) > 1 else 0.0
    conf = 0.55 + 0.1 * min(top, 4.0)
    if second and second >= top * 0.7:
        conf -= 0.25  # two plausible titles: low confidence, user must decide
    conf *= min(1.0, ocr_conf + 0.1)
    return key, round(max(0.2, min(conf, 0.98)), 3), {k: round(v, 2) for k, v in scores.items() if v}


def statistics_conf(rows) -> float:
    c = [r.conf for r in rows]
    return sum(c) / len(c) if c else 0.0




VAT_RE = re.compile(r"(?:\bTRN\b|\bVAT\b|\bGSTIN\b|\bGST\b|Tax\s*(?:Reg\w*|ID|No\.?))\s*(?:no\.?|number|#|reg\w*|id)?[\s:.#\-]*([A-Z0-9][A-Z0-9\-]{5,19})", re.I)
CT_RE = re.compile(r"corporate\s*tax\s*(?:reg\w*\s*)?(?:no\.?|number|id|#)?[\s:.#\-]*([A-Z0-9][A-Z0-9\-]{5,19})", re.I)
TL_RE = re.compile(r"(?:trade\s*)?licen[cs]e\s*(?:no\.?|number|#)?[\s:.#\-]*([A-Z0-9][A-Z0-9\-/]{3,24})", re.I)
DUNS_RE = re.compile(r"D-?U-?N-?S\s*(?:no\.?|number|#)?[\s:.#\-]*(\d[\d\-]{7,12}\d)", re.I)
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
PHONE_RE = re.compile(r"(?:tel|phone|mob(?:ile)?|ph|contact)[^\d+]{0,10}(\+?\d[\d\s().-]{7,17}\d)", re.I)
NO_RE = re.compile(
    r"\b(?:invoice|inv|pro\s*-?forma|quotation|quote|pi|credit\s*note|debit\s*note|delivery\s*note|bill|document|doc|ref(?:erence)?|order)\b\s*(?:no\.?|number|num|#|id)\s*[:.#\-]?\s*([A-Z0-9][A-Z0-9\-/_.]{2,})"
    r"|\b(?:invoice|pro\s*-?forma|quotation|quote|credit\s*note|debit\s*note|delivery\s*note)\b\s*:\s*([A-Z0-9][A-Z0-9\-/_.]{2,})", re.I)


def _has_digits(v: str, n: int = 1) -> bool:
    return len(re.findall(r"\d", v)) >= n


def extract_invoice(result: ReadResult, file_name: str = "") -> dict:
    rows = to_rows(result)
    full = "\n".join(r.text for r in rows)
    review: list[str] = []
    warnings: list[str] = []
    fconf: dict[str, float] = {}
    fields: dict[str, dict] = {}
    used_ocr = any(p.source == "ocr" for p in result.pages)

    def track(name: str, value, conf: float | None, page: int | None):
        """Record a field with confidence and source page. No conf => not found."""
        if conf is not None:
            fconf[name] = round(conf, 3)
        fields[name] = {"value": value, "confidence": None if conf is None else round(conf, 3), "page": page, "level": level(conf) if value not in ("", None) or conf is not None else "none"}

    def flag(field: str, conf: float | None = None, value=None, page: int | None = None):
        track(field, value if value is not None else "", conf, page)
        if (conf is None or conf < LOW_CONF) and field not in review:
            review.append(field)

    def need(field: str):
        if field not in review:
            review.append(field)

    # ── document type ───────────────────────────────────────────────────────
    doc_type, type_conf, type_scores = detect_type(f"{full[:900]} {file_name}", statistics_conf(rows))
    track("document_type", doc_type, type_conf, 1)
    if doc_type == "other" or type_conf < 0.7:
        need("document_type")

    # ── number / dates / currency ───────────────────────────────────────────
    number, nconf, npage = "", 0.0, 1
    for r in rows[:60]:
        for x in NO_RE.finditer(r.text):
            cand = x[1] or x[2]
            if _has_digits(cand) and not re.match(r"(date|total)", cand, re.I):
                number, nconf, npage = cand.rstrip(".,"), r.conf, r.page
                break
        if number:
            break
    flag("invoice_number", nconf if number else None, number, npage)
    if used_ocr and number and nconf < 0.9:
        need("invoice_number")  # identifiers are the most OCR-fragile text: only trust them when read confidently

    inv_date = due_date = ""
    dconf, dpage = None, 1
    dated = [(r, parse_date(r.text)) for r in rows]
    for r, d in dated:  # prefer a row that is labelled as the document date
        if d and re.search(r"\bdate\b|issued", r.text, re.I) and not re.search(r"due|payment|valid|expir", r.text, re.I):
            inv_date, dconf, dpage = d[0], (0.5 if d[1] else r.conf), r.page
            if d[1]:
                warnings.append("The document date was read as day/month/year - please confirm.")
            break
    for r, d in dated:
        if not d:
            continue
        if re.search(r"due|payment\s*date|valid|expir", r.text, re.I):
            due_date = due_date or d[0]
        elif not inv_date:
            inv_date, dconf, dpage = d[0], (0.5 if d[1] else r.conf), r.page
            if d[1]:
                warnings.append("The document date was read as day/month/year - please confirm.")
    flag("invoice_date", dconf, inv_date, dpage) if inv_date else flag("invoice_date")
    if due_date:
        track("due_date", due_date, 0.9, 1)

    currency = detect_currency(full)
    if currency:
        track("currency", currency, 0.9, 1)
    else:
        flag("currency")

    # ── parties ─────────────────────────────────────────────────────────────
    def find_row(rx: re.Pattern) -> int:
        return next((k for k, r in enumerate(rows) if rx.search(r.text)), -1)

    bill_rx = re.compile(r"\b(bill(?:ed)?\s*to|sold\s*to|customer|buyer|consignee|client|invoice\s*to|deliver(?:ed)?\s*to)\b\s*[:.]?", re.I)
    ship_rx = re.compile(r"\bship(?:ped)?\s*to\b\s*[:.]?", re.I)
    frm_rx = re.compile(r"\b(from|seller|vendor|supplier|exporter)\b(?!\s+(?:bill|invoice|copy))\s*[:.]?", re.I)

    def party(rx: re.Pattern):
        i = find_row(rx)
        if i < 0:
            return None
        inline = re.sub(r"^[\s:.\-]+", "", rx.sub("", rows[i].text, count=1)).strip()
        lines = [Row(inline, rows[i].conf, rows[i].page)] if inline else []
        for j in range(i + 1, len(rows)):
            if len(lines) >= 5:
                break
            t = rows[j].text
            if not t.strip() or HEADER_RE.search(t) or re.match(r"(description|item|s\.?no|sl)\b", t, re.I) or parse_date(t) or re.search(r"(invoice|date|due|ship\s*to|phone|tel|email|trn|vat)\s*[:#]", t, re.I):
                break
            lines.append(rows[j])
        if not lines:
            return None
        return {"idx": i, "name": re.split(r"\s{2,}", lines[0].text)[0].strip(),
                "address": ", ".join(re.split(r"\s{2,}", l.text)[0] for l in lines[1:]),
                "conf": min(l.conf for l in lines), "page": rows[i].page, "end": i + len(lines)}

    bill, ship, frm = party(bill_rx), party(ship_rx), party(frm_rx)
    bill_idx = bill["idx"] if bill else -1

    customer = bill["name"] if bill else ""
    flag("customer_name", bill["conf"] if bill else None, customer, bill["page"] if bill else None)
    if bill and bill["address"]:
        track("customer_address", bill["address"], bill["conf"], bill["page"])

    # issuer = the company printed in the letterhead (first rows of page 1, before the bill-to block)
    top = [k for k, r in enumerate(rows) if r.page == 1][:14]
    top = [k for k in top if bill_idx < 0 or k < bill_idx]

    TITLE_RX = re.compile(r"\b(?:tax\s+invoice|purchase\s+invoice|supplier\s+(?:invoice|bill)|pro\s*-?forma(?:\s+invoice)?|invoice|quotation|quote|credit\s+note|debit\s+note|delivery\s+note|bill)\b", re.I)

    def is_junk(t: str) -> bool:
        return bool(":" in t or re.search(r"total|vat|\btax\b|amount|qty|quantity|invoice|pro\s*-?forma|quotation|credit note|debit note|delivery note|\bdate\b|page \d", t, re.I) or EMAIL_RE.search(t) or PHONE_RE.search(t))

    supplier, sconf, spage = "", None, 1
    if frm:
        supplier, sconf, spage = frm["name"], frm["conf"], frm["page"]
    else:
        for k in top:
            cell = TITLE_RX.sub(" ", re.split(r"\s{2,}", rows[k].text)[0]).strip(" -:|")  # a title merged into the same OCR cell
            if re.search(r"[A-Za-z]{3}", cell) and len(re.findall(r"\d[\d.,]*", cell)) < 2 and not is_junk(cell):
                supplier, sconf, spage = cell, min(rows[k].conf, 0.6), rows[k].page  # header guess: always review
                name_row = k
                break
    flag("supplier_name", sconf, supplier, spage) if supplier else flag("supplier_name")

    issuer_addr = ""
    if supplier and not frm:
        k0 = next((k for k in top if supplier[:10] in rows[k].text), None)
        if k0 is not None:
            addr = []
            for k in [x for x in top if x > k0][:5]:
                cell = re.split(r"\s{2,}", rows[k].text)[0].strip()
                if cell and not is_junk(cell):
                    addr.append(cell)
                if len(addr) == 3:
                    break
            issuer_addr = ", ".join(addr)
    if issuer_addr:
        track("issuer_address", issuer_addr, 0.6, 1)

    issuer_text = "\n".join(rows[k].text for k in top)
    m = EMAIL_RE.search(issuer_text)
    issuer_email = m[0] if m else ""
    m = PHONE_RE.search(issuer_text)
    issuer_phone = m[1].strip() if m else ""
    cust_window = "\n".join(r.text for r in rows[bill_idx: bill_idx + 8]) if bill_idx >= 0 else ""
    m = EMAIL_RE.search(cust_window) if cust_window else EMAIL_RE.search(full)
    email = m[0] if m and m[0] != issuer_email else (m[0] if m and not issuer_email else "")
    m = PHONE_RE.search(cust_window) if cust_window else None
    phone = m[1].strip() if m else ""
    if issuer_email:
        track("issuer_email", issuer_email, 0.9, 1)
    if issuer_phone:
        track("issuer_phone", issuer_phone, 0.85, 1)
    if email:
        track("customer_email", email, 0.9, 1)

    # VAT / TRN: a number inside the bill-to window belongs to the customer, any other to the issuer
    vats = []
    for k, r in enumerate(rows):
        for mm in VAT_RE.finditer(r.text):
            v = mm[1]
            if _has_digits(v, 6) and not re.search(r"corporate", r.text[: mm.start()][-20:], re.I):
                vats.append((k, v, r.conf, r.page))
    issuer_vat = customer_vat = ""
    for k, v, c, pg in vats:
        in_cust = bill_idx >= 0 and bill_idx <= k <= bill_idx + 8
        if in_cust and not customer_vat:
            customer_vat = v; track("customer_vat", v, c, pg)
        elif not in_cust and not issuer_vat:
            issuer_vat = v; track("issuer_vat", v, c, pg)
    # a lone number printed with no bill-to context is the issuer's
    m = CT_RE.search(full)
    corporate_tax = m[1] if m and _has_digits(m[1], 6) else ""
    m = TL_RE.search(full)
    trade_license = m[1] if m and _has_digits(m[1], 3) else ""
    m = DUNS_RE.search(full)
    duns = m[1] if m else ""
    for name, val in (("issuer_corporate_tax", corporate_tax), ("issuer_trade_license", trade_license), ("issuer_duns", duns)):
        if val:
            track(name, val, 0.85, 1)
    if customer_vat or issuer_vat:
        pass

    m = re.search(r"(?:payment\s*terms?|terms)\s*[:\-]\s*(.+)", full, re.I)
    terms = m[1].strip() if m else ""

    # ── line items ──────────────────────────────────────────────────────────
    items: list[dict] = []
    uncertain = 0
    hi = next((k for k, r in enumerate(rows) if HEADER_RE.search(r.text)), -1)
    cols, sku_first, has_sku_col = header_layout(rows[hi].text) if hi >= 0 else ([], False, False)
    last_item_row = -1
    for i in range(hi + 1 if hi >= 0 else 0, len(rows)):
        t = rows[i].text
        if TOTALS_RE.match(t):
            if items:
                break
            continue
        if HEADER_RE.search(t):
            continue
        p = parse_item_row(t, rows[i].mean, cols, sku_first, has_sku_col)
        if p and hi < 0 and not p[1]:
            p = None  # no table header to anchor on: accept only rows whose qty x price matches the amount
        if p:
            item, ok, c = p
            ok = ok and c >= 0.7  # arithmetic consistency is the main evidence; confidence only vetoes very weak rows
            item["confidence"] = round(c if ok else min(c, 0.5), 3)
            item["page"] = rows[i].page
            uncertain += 0 if ok else 1
            items.append(item)
            last_item_row = i
        elif items and i == last_item_row + 1 and hi >= 0 and len(t) < 90 and ":" not in t and not re.search(r"\d[\d.,]*\s*$", t) and re.search(r"[A-Za-z]{3}", t):
            items[-1]["description"] += " " + t.strip()  # description wrapped onto the next line
            last_item_row = i
    if not items:
        need("line_items")
        warnings.append("No line items could be read. Enter them manually.")
        track("line_items", [], None, None)
    else:
        share = 1 - uncertain / len(items)
        fconf["line_items"] = round(0.95 if uncertain == 0 else max(0.2, share * 0.7), 3)
        track("line_items", len(items), fconf["line_items"], items[0]["page"])
        if hi < 0:
            need("line_items")
            warnings.append("No table header was found; line items were read by row shape only - verify them.")
        if uncertain:
            need("line_items")
            warnings.append(f"{uncertain} of {len(items)} line item(s) have low OCR confidence or quantity x price does not match the total - verify against the original.")

    # ── totals ──────────────────────────────────────────────────────────────
    sub = labelled(rows, r"sub\s*-?\s*total")
    grand = (labelled(rows, r"grand\s*total", None)
             or labelled(rows, r"invoice\s*total|total\s*amount|net\s*total|total\s*payable|total\s*due", r"sub\s*-?\s*total")
             or labelled(rows, r"^\s*total\b", r"sub\s*-?\s*total|total\s*(qty|quantity|weight|pcs)"))
    balance = labelled(rows, r"balance(?:\s*due)?|amount\s*due|outstanding")
    if not grand and balance:
        grand = balance
        warnings.append("Only a balance / amount due was printed; it was used as the total - confirm.")
        need("total")
    paid = labelled(rows, r"amount\s*paid|paid\s*amount|payments?\s*received|\bpaid\b", r"paid\s*to")
    tax = labelled(rows, r"\b(?:vat|gst|igst|cgst|sgst|tax)\b(?:[^\d\n]*?\d+(?:\.\d+)?\s*%\)?)?", r"tax\s*invoice|tax\s*(?:reg|id|no)|\bvat\s*(?:no|number|reg)|\btrn\b")
    freight = labelled(rows, r"(freight|shipping|delivery|courier)(?:\s*(?:charges?|cost|fee))?", r"delivery\s*(?:note|date|terms)|ship\s*to")
    disc = labelled(rows, r"discount(?:\s*amount)?")
    other = labelled(rows, r"(other\s*charges?|handling|packing|insurance|misc\w*)")
    val = lambda t: t[0] if t else 0.0
    totals = {"subtotal": val(sub), "discount": abs(val(disc)), "tax": val(tax), "freight": val(freight), "other_charges": val(other), "total": val(grand), "paid": val(paid), "balance": val(balance) if grand is not balance else 0.0}
    for name, t in (("subtotal", sub), ("total", grand)):
        flag(name, t[1] if t else None, val(t), t[2] if t else None)
    for name, t in (("tax", tax), ("freight", freight), ("discount", disc), ("other_charges", other), ("paid", paid), ("balance", balance)):
        if t:
            flag(name, t[1], totals.get(name), t[2])
    # Scanned totals are trusted only when they reconcile arithmetically (checked below) and were read confidently.
    if used_ocr:
        for name, t in (("total", grand), ("subtotal", sub)):
            if t and t[1] < 0.9:
                need(name)

    rnd = lambda n: round(n * 100) / 100
    items_sum = rnd(sum(i["total"] for i in items))
    tax_sum = rnd(sum(i["tax"] for i in items))
    disc_sum = rnd(sum(i["discount"] for i in items))
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

    empty_pages = [p.page for p in result.pages if not p.lines]
    if not rows:
        warnings.append("No text could be read from this file.")
    elif any(p.source == "ocr" and p.mean_conf < 0.55 for p in result.pages):
        warnings.append("OCR could not confidently read this document. Please review the highlighted fields.")
    if empty_pages and rows:
        warnings.append(f"No text was found on page(s) {', '.join(map(str, empty_pages))}.")

    confs = [r.conf for r in rows]
    return {
        "document_type": doc_type,
        "type_confidence": type_conf,
        "type_scores": type_scores,
        "confidence": round(sum(confs) / len(confs), 3) if confs else 0.0,
        "data": {
            "invoice_number": number, "invoice_date": inv_date, "due_date": due_date,
            "customer_name": customer, "supplier_name": supplier,
            "vat_number": customer_vat or issuer_vat, "customer_vat": customer_vat,
            "currency": currency, "payment_terms": terms, "email": email, "phone": phone,
            "billing_address": bill["address"] if bill else "",
            "shipping_address": ", ".join(x for x in ((ship or {}).get("name"), (ship or {}).get("address")) if x),
            "issuer_address": issuer_addr, "issuer_phone": issuer_phone, "issuer_email": issuer_email, "issuer_vat": issuer_vat,
            "issuer_corporate_tax": corporate_tax, "issuer_trade_license": trade_license, "issuer_duns": duns,
            **totals, "line_items": items,
        },
        "fields": fields,
        "review_fields": review,
        "field_confidence": fconf,
        "warnings": warnings,
        "page_count": result.page_count,
        "is_scanned": used_ocr,
    }
