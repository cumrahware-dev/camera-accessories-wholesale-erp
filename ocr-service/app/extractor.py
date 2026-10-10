"""
Structured invoice/proforma extraction from OCR lines.

Rules: never invent a value. Anything not found stays empty/0 and is listed in
`review_fields`; arithmetic inconsistencies are reported in `warnings`, never silently fixed.
"""
from __future__ import annotations

import logging
import re

from .reader import ReadResult

LOW_CONF = 0.85
MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
CURRENCIES = ["USD", "AED", "INR", "EUR", "GBP", "SAR", "CNY", "JPY", "SGD", "HKD", "AUD", "CAD", "CHF", "QAR", "KWD", "OMR", "BHD", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RON", "TRY", "ZAR", "THB", "MYR", "KRW", "NZD", "PKR", "BDT", "LKR", "EGP", "JOD", "IDR", "PHP", "VND", "TWD", "ILS", "MXN", "BRL", "RUB"]
NUM = r"-?\d[\d.,]*"


from .layout import Row, to_rows, labeled_value
from . import aliases, numbers, tables


def parse_amount(raw: str) -> float | None:
    """Amount from printed text; separators are interpreted per the document's detected style (see numbers.py)."""
    return numbers.parse_float(raw)


def _fmt(y: int, mo: int, d: int) -> str | None:
    return f"{y}-{mo:02d}-{d:02d}" if 1 <= mo <= 12 and 1 <= d <= 31 else None


def parse_date(raw: str, month_first: bool = False) -> tuple[str, bool] | None:
    """Returns (ISO date, ambiguous_day_month_order). Day-first by default (UAE / India); month-first when the
    day-first reading is impossible (03/24/2026) or the document itself uses month-first dates."""
    m = re.search(r"\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b", raw)
    if m:
        iso = _fmt(int(m[1]), int(m[2]), int(m[3]))
        return (iso, False) if iso else None
    m = re.search(r"\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b", raw)
    if m:
        y = int(m[3]) + (2000 if int(m[3]) < 100 else 0)
        a, b = int(m[1]), int(m[2])
        dmy, mdy = _fmt(y, b, a), _fmt(y, a, b)
        if dmy and mdy and a != b:
            return (mdy if month_first else dmy), not month_first
        iso = dmy or mdy
        return (iso, False) if iso else None
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
        whole = re.fullmatch(r"[\s:.\-]*(?:[A-Z]{3}|[$€£₹]|Rs\.?)?\s*(-?\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d{1,2})?)\s*", after, re.I)
        nums = [whole.group(1).replace(" ", "").replace("\u00a0", "").replace("\u202f", "")] if whole else re.findall(NUM, after)
        if not nums:
            continue
        v = parse_amount(nums[-1])
        if v is not None:
            return v, r.conf, r.page, r
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



log = logging.getLogger("ocr-service")

TYPE_RULES = {
    "tax_invoice": [(r"(?:tax|vat)\s+invoice", 3.0)],
    "proforma_invoice": [(r"pro\s*-?forma", 3.0)],
    "quotation": [(r"quotation|\bquote\b|\bestimate\b|\bquot\.?\s*(?:no|#)", 3.0)],
    "credit_note": [(r"credit\s+(?:note|memo)", 3.0)],
    "debit_note": [(r"debit\s+(?:note|memo)", 3.0)],
    "delivery_note": [(r"delivery\s+(?:note|challan)|goods\s+delivery|dispatch\s+note", 3.0)],
    "purchase_invoice": [(r"purchase\s+invoice|supplier\s+invoice|vendor\s+invoice", 3.0)],
    "purchase_bill": [(r"(?<!bill to)\bbill\b(?!\s*(?:to|ed))", 1.5), (r"vendor\s+bill|supplier\s+bill|purchase\s+bill", 3.0)],
    "invoice": [(r"\binvoice\b", 1.5), (r"commercial\s+invoice", 1.0), (r"\binv\.?\s*(?:no|number|#)", 1.5)],
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


ID_VALUE = r"[A-Z0-9][A-Z0-9\-/_.]*\d[A-Z0-9\-/_.]*"
DATE_VALUE = (r"\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}"
              r"|\d{1,2}(?:st|nd|rd|th)?[\s\-,]+[A-Za-z]{3,9}\.?[\s\-,]+\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}")
PARTY_STOP = re.compile(r"^\s*(?:invoice|date|due|payment|terms|ship\s*to|page|description|item|qty|s\.?\s*no|sl\b)", re.I)
CONTACT_LINE = re.compile(r"^\s*(?:trn|vat|gstin|gst|tax|tel|phone|mob|mobile|fax|email|e-mail|contact|attn|pan)\b", re.I)


SUFFIX_FIX = {"lid": "Ltd", "itd": "Ltd", "1td": "Ltd", "ltd": "Ltd", "lld": "Ltd", "llg": "LLC", "l1c": "LLC", "lic": "LLC", "llc": "LLC",
              "fze": "FZE", "fz-llc": "FZ-LLC", "fzco": "FZCO", "pvt": "Pvt", "pvi": "Pvt", "inc": "Inc", "gmbh": "GmbH", "plc": "PLC"}


def fix_company_suffix(name: str) -> str:
    """Repairs classic OCR slips in legal suffixes ("Pvt Lid" -> "Pvt Ltd"). Only the last two words are touched."""
    words = name.split()
    for i in range(max(0, len(words) - 2), len(words)):
        key = words[i].strip(".,").lower()
        fixed = SUFFIX_FIX.get(key)
        if fixed and words[i].strip(".,") not in (fixed, fixed.upper()):
            words[i] = fixed if key not in ("ltd", "llc", "fze", "pvt", "inc", "plc") or words[i].strip(".,").islower() else words[i]
    return " ".join(words)


def vat_format_issue(v: str) -> str:
    """Empty when the registration number has a known, valid shape (or an unknown but plausible one)."""
    s = re.sub(r"[\s\-]", "", v.upper())
    if re.fullmatch(r"\d+", s):
        if s.startswith("100") or s.startswith("200") or s.startswith("300"):
            return "" if len(s) == 15 else f"UAE TRN numbers have 15 digits; this one has {len(s)}."
        return "" if 8 <= len(s) <= 15 else "Unusual length for a tax registration number."
    if re.fullmatch(r"\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]", s):
        return ""  # Indian GSTIN
    if re.fullmatch(r"[A-Z]{2}[0-9A-Z]{2,13}", s):
        return ""  # EU / GB style
    return "" if re.search(r"\d{6,}", s) else "This does not look like a tax registration number."


def _legacy_items(rows: list[Row]):
    """Token-order fallback for tables whose header could not be mapped to word positions."""
    out = []
    hi = next((k for k, r in enumerate(rows) if HEADER_RE.search(r.text)), -1)
    cols, sku_first, has_sku_col = header_layout(rows[hi].text) if hi >= 0 else ([], False, False)
    last = -1
    for i in range(hi + 1 if hi >= 0 else 0, len(rows)):
        t = rows[i].text
        if TOTALS_RE.match(t):
            if out:
                break
            continue
        if HEADER_RE.search(t):
            continue
        p = parse_item_row(t, rows[i].mean, cols, sku_first, has_sku_col)
        if p and hi < 0 and not p[1]:
            p = None
        if p:
            out.append((p[0], p[1], p[2], rows[i]))
            last = i
        elif out and i == last + 1 and hi >= 0 and len(t) < 90 and ":" not in t and not re.search(r"\d[\d.,]*\s*$", t) and re.search(r"[A-Za-z]{3}", t):
            out[-1][0]["description"] += " " + t.strip()
            last = i
    return out, hi >= 0


def extract_invoice(result: ReadResult, file_name: str = "", number_style_hint: str | None = None) -> dict:
    rows = to_rows(result)
    full = "\n".join(r.text for r in rows)
    number_style = numbers.begin_document(full, number_style_hint)
    review: list[str] = []
    warnings: list[str] = []
    fconf: dict[str, float] = {}
    fields: dict[str, dict] = {}
    used_ocr = any(p.source == "ocr" for p in result.pages)

    def track(name: str, value, conf: float | None, page: int | None, bbox: dict | None = None):
        """Record a field with confidence, source page and position. No conf => not found."""
        if conf is not None:
            fconf[name] = round(conf, 3)
        fields[name] = {"value": value, "confidence": None if conf is None else round(conf, 3), "page": page,
                        "level": level(conf) if value not in ("", None) or conf is not None else "none", "bbox": bbox or None}

    def flag(field: str, conf: float | None = None, value=None, page: int | None = None, bbox: dict | None = None):
        track(field, value if value is not None else "", conf, page, bbox)
        if (conf is None or conf < LOW_CONF) and field not in review:
            review.append(field)

    def need(field: str):
        if field not in review:
            review.append(field)

    # ── number ──────────────────────────────────────────────────────────────
    number, nconf, npage, nbox = "", 0.0, 1, None
    hit = labeled_value(rows, aliases.pattern("invoice_number"), ID_VALUE, max_rows=70)
    if hit and not parse_date(hit[0]):
        number, nconf, npage, nbox = hit[0].rstrip(".,"), hit[1], hit[2].page, hit[2].bbox([hit[3]])
    else:
        for r in rows[:60]:
            for x in NO_RE.finditer(r.text):
                cand = x[1] or x[2]
                if _has_digits(cand) and not re.match(r"(date|total)", cand, re.I):
                    number, nconf, npage, nbox = cand.rstrip(".,"), r.conf, r.page, r.bbox()
                    break
            if number:
                break
    flag("invoice_number", nconf if number else None, number, npage, nbox)
    if used_ocr and number and nconf < 0.9:
        need("invoice_number")  # identifiers are the most OCR-fragile text: only trust them when read confidently

    # ── document type (title, keywords, numbering pattern) ──────────────────
    prefix_hint = ""
    if number:
        pm = re.match(r"(PI|PF|QT|QUO|CN|DN|DLV|PO|PB|BILL)\b[-/]?", number, re.I)
        prefix_hint = {"pi": " proforma", "pf": " proforma", "qt": " quotation", "quo": " quotation", "cn": " credit note", "dn": " debit note",
                       "dlv": " delivery note", "pb": " purchase bill", "bill": " bill"}.get(pm[1].lower(), "") if pm else ""
    doc_type, type_conf, type_scores = detect_type(f"{full[:1500]} {file_name}{prefix_hint}", statistics_conf(rows))
    if doc_type == "other" and len(full) > 1500:
        # the title can sit lower on letterhead-heavy or multi-page documents: look at the whole text before giving up
        doc_type, type_conf, type_scores = detect_type(f"{full} {file_name}{prefix_hint}", statistics_conf(rows))
    log.info("DOCUMENT TYPE DETECTED type=%s confidence=%s text_len=%d", doc_type, type_conf, len(full))
    track("document_type", doc_type, type_conf, 1)
    if doc_type == "other" or type_conf < 0.7:
        need("document_type")

    # ── dates (day-first unless the document itself proves month-first) ────
    month_first = any(int(m[2]) > 12 and int(m[1]) <= 12 for m in re.finditer(r"\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b", full))
    inv_date = due_date = ""
    dconf, dpage, dbox = None, 1, None
    hit = labeled_value(rows, aliases.pattern("invoice_date"), DATE_VALUE, exclude=aliases.pattern("due_date"), max_rows=80)
    if hit and parse_date(hit[0], month_first):
        d = parse_date(hit[0], month_first)
        inv_date, dconf, dpage, dbox = d[0], (0.5 if d[1] else hit[1]), hit[2].page, hit[2].bbox([hit[3]])
        if d[1]:
            warnings.append("The document date could be read as day/month or month/day - it was read as day/month/year; please confirm.")
    hit = labeled_value(rows, aliases.pattern("due_date"), DATE_VALUE, max_rows=90)
    if hit and parse_date(hit[0], month_first):
        due_date = parse_date(hit[0], month_first)[0]
    if not inv_date:
        for r in rows:
            d = parse_date(r.text, month_first)
            if d and not re.search(r"due|payment\s*date|valid|expir", r.text, re.I):
                inv_date, dconf, dpage, dbox = d[0], (0.5 if d[1] else min(r.conf, 0.7)), r.page, r.bbox()
                need("invoice_date")  # an unlabelled date is only a guess
                break
    flag("invoice_date", dconf, inv_date, dpage, dbox) if inv_date else flag("invoice_date")
    if inv_date:
        from datetime import date as _date, timedelta as _td
        y, mo, dd = (int(x) for x in inv_date.split("-"))
        try:
            dt = _date(y, mo, dd)
            if dt > _date.today() + _td(days=30) or dt.year < 2000:
                need("invoice_date")
                warnings.append(f"The document date {inv_date} looks implausible - please review.")
        except ValueError:
            need("invoice_date")
            warnings.append(f"The document date {inv_date} is not a valid calendar date - please review.")
    if due_date:
        track("due_date", due_date, 0.9, 1)

    currency = detect_currency(full)
    if currency:
        track("currency", currency, 0.9, 1)
    else:
        flag("currency")

    # ── parties: labelled sections first, letterhead only as a fallback ────
    def section(key: str):
        pat = re.compile(r"^\s*(" + aliases.pattern(key) + r")\s*([:.\-]?)\s*(.*)$", re.I)
        for ri, r in enumerate(rows[:90]):
            for cell in r.cells:
                m = pat.match(cell.text)
                if not m:
                    continue
                lab, colon, rest = m.group(1), m.group(2), m.group(3).strip()
                if (len(lab.strip()) <= 3 and not colon) or (rest and not colon):
                    continue  # "To" needs a colon; "Customer Service Centre" is not a section label
                got = [(rest, cell.conf, r, cell)] if rest else []
                prev_y1 = r.y1
                lh = max(6.0, r.y1 - r.y0)
                for r2 in rows[ri + 1: ri + 9]:
                    if r2.page != r.page or r2.y0 - prev_y1 > 2.2 * lh:
                        break
                    c2 = next((c for c in r2.cells if abs(c.x0 - cell.x0) < max(25.0, lh * 2)), None)
                    if c2 is None:
                        if got:
                            break
                        continue
                    if PARTY_STOP.match(c2.text) or HEADER_RE.search(r2.text) or tables.is_header(r2):
                        break
                    got.append((c2.text, c2.conf, r2, c2))
                    prev_y1 = r2.y1
                    if len(got) >= 6:
                        break
                if not got:
                    continue
                name_i = next((i for i, g in enumerate(got) if not CONTACT_LINE.match(g[0])), None)
                if name_i is None:
                    continue
                name = got[name_i]
                addr = [g[0] for g in got[name_i + 1:] if not CONTACT_LINE.match(g[0]) and not EMAIL_RE.search(g[0])]
                return {"idx": ri, "rows": {id(g[2]) for g in got} | {id(r)}, "first": ri, "last": rows.index(got[-1][2]),
                        "name": name[0].strip(" ,"), "address": ", ".join(addr), "conf": min(g[1] for g in got[: name_i + 1]),
                        "page": r.page, "bbox": name[2].bbox([name[3]]), "text": "\n".join(g[0] for g in got)}
        return None

    bill, ship, frm = section("customer_section"), section("ship_section"), section("supplier_section")
    if bill and frm and bill["first"] == frm["first"] and bill["name"] == frm["name"]:
        frm = None
    bill_idx = bill["idx"] if bill else -1

    customer = fix_company_suffix(bill["name"]) if bill else ""
    if bill and customer != bill["name"]:
        bill["conf"] = min(bill["conf"], 0.7)  # corrected an OCR slip in the legal suffix: show it for review
    flag("customer_name", bill["conf"] if bill else None, customer, bill["page"] if bill else None, bill["bbox"] if bill else None)
    if bill and bill["address"]:
        track("customer_address", bill["address"], bill["conf"], bill["page"])

    top = [k for k, r in enumerate(rows) if r.page == 1][:14]
    top = [k for k in top if bill_idx < 0 or k < bill_idx]

    TITLE_RX = re.compile(r"\b(?:tax\s+invoice|purchase\s+invoice|supplier\s+(?:invoice|bill)|sales\s+invoice|pro\s*-?forma(?:\s+invoice)?|invoice|quotation|quote|credit\s+note|debit\s+note|delivery\s+note|bill)\b", re.I)

    def is_junk(t: str) -> bool:
        return bool(":" in t or re.search(r"total|vat|\btax\b|amount|qty|quantity|invoice|pro\s*-?forma|quotation|credit note|debit note|delivery note|\bdate\b|page \d", t, re.I) or EMAIL_RE.search(t) or PHONE_RE.search(t))

    supplier, sconf, spage, sbox = "", None, 1, None
    if frm:
        supplier, sconf, spage, sbox = fix_company_suffix(frm["name"]), frm["conf"], frm["page"], frm["bbox"]
        if supplier != frm["name"]:
            sconf = min(sconf, 0.7)
    else:
        for k in top:
            first = rows[k].cells[0] if rows[k].cells else None
            cell = TITLE_RX.sub(" ", first.text if first else rows[k].text).strip(" -:|")
            if re.search(r"[A-Za-z]{3}", cell) and len(re.findall(r"\d[\d.,]*", cell)) < 2 and not is_junk(cell):
                supplier, sconf, spage, sbox = cell, min(rows[k].conf, 0.6), rows[k].page, rows[k].bbox([first] if first else None)  # header guess: always review
                break
    flag("supplier_name", sconf, supplier, spage, sbox) if supplier else flag("supplier_name")

    issuer_addr = ""
    if frm:
        issuer_addr = frm["address"]
    elif supplier:
        k0 = next((k for k in top if supplier[:10] in rows[k].text), None)
        if k0 is not None:
            addr = []
            for k in [x for x in top if x > k0][:5]:
                cell = rows[k].cells[0].text.strip() if rows[k].cells else ""
                if cell and not is_junk(cell):
                    addr.append(cell)
                if len(addr) == 3:
                    break
            issuer_addr = ", ".join(addr)
    if issuer_addr:
        track("issuer_address", issuer_addr, 0.6, 1)

    cust_rows = set(range(bill["first"], bill["last"] + 1)) if bill else set()
    issuer_rows = set(range(frm["first"], frm["last"] + 1)) if frm else set(top)
    issuer_text = "\n".join(rows[k].text for k in sorted(issuer_rows))
    m = EMAIL_RE.search(issuer_text)
    issuer_email = m[0] if m else ""
    m = PHONE_RE.search(issuer_text)
    issuer_phone = m[1].strip() if m else ""
    cust_window = bill["text"] if bill else ""
    m = EMAIL_RE.search(cust_window) if cust_window else None
    email = m[0] if m and m[0] != issuer_email else ""
    m = PHONE_RE.search(cust_window) if cust_window else None
    phone = m[1].strip() if m else ""
    if issuer_email:
        track("issuer_email", issuer_email, 0.9, 1)
    if issuer_phone:
        track("issuer_phone", issuer_phone, 0.85, 1)
    if email:
        track("customer_email", email, 0.9, 1)

    # VAT / TRN: inside the customer section it is the customer's, otherwise the issuer's
    vats = []
    vat_label_rows = []
    for k, r in enumerate(rows):
        if re.search(r"\b(?:TRN|VAT\s*(?:reg|no|number|id)|GSTIN|tax\s*reg)", r.text, re.I) and not re.search(r"corporate", r.text, re.I):
            vat_label_rows.append(k)
        for mm in VAT_RE.finditer(r.text):
            v = mm[1]
            if _has_digits(v, 6) and not re.search(r"corporate", r.text[: mm.start()][-20:], re.I):
                vats.append((k, v, r.conf, r.page, r))
    if not any(k not in cust_rows for k, *_ in vats):
        # OCR often turns "TRN" into "TAN"/"TRM": a 15-digit UAE TRN (100…/200…/300…) printed outside the customer block is the issuer's
        for k, r in enumerate(rows[:40]):
            mm = re.search(r"(?<!\d)((?:100|200|300)\d{12})(?!\d)", r.text.replace(" ", ""))
            if mm and k not in cust_rows and not re.search(r"iban|a/?c|account|bank", r.text, re.I):
                vats.append((k, mm[1], min(r.conf, 0.6), r.page, r))
                break
    issuer_vat = customer_vat = ""
    for k, v, c, pg, r in vats:
        in_cust = k in cust_rows or (bill_idx >= 0 and not cust_rows and bill_idx <= k <= bill_idx + 8)
        if in_cust and not customer_vat:
            customer_vat = v
            track("customer_vat", v, c, pg, r.bbox())
        elif not in_cust and not issuer_vat:
            issuer_vat = v
            flag("issuer_vat", c, v, pg, r.bbox())
            if used_ocr and c < 0.9:
                need("issuer_vat")
    if not issuer_vat and any(k not in cust_rows for k in vat_label_rows):
        flag("issuer_vat")  # a VAT/TRN label is printed but its number could not be read
        warnings.append("A VAT / TRN label was found but its number could not be read - please enter it.")
    elif not issuer_vat and used_ocr and any(rows[k].conf < 0.5 for k in issuer_rows if k < len(rows)):
        flag("issuer_vat")  # part of the letterhead was unreadable: the issuer's VAT may be in it
        warnings.append("Part of the supplier letterhead could not be read; check the supplier name and VAT / TRN.")
    for name, v in (("issuer_vat", issuer_vat), ("customer_vat", customer_vat)):
        issue = vat_format_issue(v) if v else ""
        if issue:
            need(name)
            warnings.append(f"{'Supplier' if name == 'issuer_vat' else 'Customer'} VAT/TRN {v}: {issue}")
    m = CT_RE.search(full)
    corporate_tax = m[1] if m and _has_digits(m[1], 6) else ""
    m = TL_RE.search(full)
    trade_license = m[1] if m and _has_digits(m[1], 3) else ""
    m = DUNS_RE.search(full)
    duns = m[1] if m else ""
    for name, val in (("issuer_corporate_tax", corporate_tax), ("issuer_trade_license", trade_license), ("issuer_duns", duns)):
        if val:
            track(name, val, 0.85, 1)

    m = re.search(r"(?:payment\s*terms?|terms)\s*[:\-]\s*(.+)", full, re.I)
    terms = re.split(r"\s{2,}", m[1].strip())[0] if m else ""

    # ── line items (column positions first, token order as fallback) ───────
    col_items: list = []
    header_found = False
    for hi, r in enumerate(rows):
        cols = tables.header_columns(r)
        if cols:
            header_found = True
            col_items, _ = tables.parse_rows(rows, hi + 1, cols)
            break
    leg_items, leg_header = _legacy_items(rows)
    header_found = header_found or leg_header
    # Two independent readings of the table (word positions vs token order). Per row keep the one that
    # reconciles (qty x price = amount), then the one with a SKU, then the positional one.
    best: dict[int, tuple] = {}
    order = {id(r): k for k, r in enumerate(rows)}
    for src, lst in (("col", col_items), ("leg", leg_items)):
        for it in lst:
            key = id(it[3])
            sku = it[0].get("sku") or ""
            code_like = bool(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9\-_./]{2,}", sku) and re.search(r"\d|-", sku))
            rank = (bool(it[1]), code_like, bool(sku), not it[0].get("recovered"), src == "col", it[2])
            if key not in best or rank > best[key][0]:
                best[key] = (rank, it)
    parsed = [v[1] for _, v in sorted(best.items(), key=lambda kv: order.get(kv[0], 0))]
    # a table row with text and several numbers that neither reading could parse must not disappear silently
    dropped = 0
    if parsed:
        hdr_k = next((k for k, r in enumerate(rows) if tables.is_header(r) or HEADER_RE.search(r.text)), None)
        first_k = min([order[id(it[3])] for it in parsed] + ([hdr_k + 1] if hdr_k is not None else []))
        last_k = max(order[id(it[3])] for it in parsed)
        for k in range(first_k, last_k + 1):
            r = rows[k]
            if id(r) not in best and re.search(r"[A-Za-z]{3}", r.text) and len(re.findall(r"\d[\d.,]*\d|\d", r.text)) >= 3 \
                    and not TOTALS_RE.match(r.text) and not tables.is_header(r):
                dropped += 1
    items: list[dict] = []
    uncertain = 0
    for item, ok, c, r in parsed:
        ok = ok and c >= 0.7  # arithmetic consistency is the main evidence; confidence only vetoes very weak rows
        if isinstance(item["quantity"], float) and not float(item["quantity"]).is_integer():
            ok = ok and True  # decimal quantities are valid (metres, kg); the ERP decides whether it accepts them
        item["confidence"] = round(c if ok else min(c, 0.5), 3)
        item["page"] = r.page
        item["bbox"] = r.bbox()
        item["needs_review"] = not ok
        uncertain += 0 if ok else 1
        items.append(item)
    if not items:
        need("line_items")
        warnings.append("No line items could be read. Enter them manually.")
        track("line_items", [], None, None)
    else:
        fconf["line_items"] = round(0.95 if uncertain == 0 else max(0.2, (1 - uncertain / len(items)) * 0.7), 3)
        track("line_items", len(items), fconf["line_items"], items[0]["page"])
        if not header_found:
            need("line_items")
            warnings.append("No table header was found; line items were read by row shape only - verify them.")
        if dropped:
            need("line_items")
            warnings.append(f"{dropped} table row(s) could not be read as line items - compare the list with the original.")
        recovered = sum(1 for i in items if i.pop("recovered", False))
        if recovered:
            need("line_items")
            warnings.append(f"Part of the table header was unreadable; {recovered} line item(s) were rebuilt from quantity x price = amount - verify quantities, prices and SKUs.")
        if uncertain:
            need("line_items")
            warnings.append(f"{uncertain} of {len(items)} line item(s) have low OCR confidence or quantity x price does not match the line amount - verify against the original.")

    # ── totals ──────────────────────────────────────────────────────────────
    total_specific = "|".join(aliases.phrase(a) for a in aliases.load()["total"] if a.lower() != "total")
    sub = labelled(rows, aliases.pattern("subtotal"))
    grand = (labelled(rows, r"grand\s*total")
             or labelled(rows, total_specific, r"sub\s*-?\s*total|before|excl")
             or labelled(rows, r"^\s*total\b", r"sub\s*-?\s*total|total\s*(qty|quantity|weight|pcs|items|units|vat|tax|discount)"))
    balance = labelled(rows, aliases.pattern("amount_due"))
    if not grand and balance:
        grand = balance
        warnings.append("Only an amount due / balance was printed; it was used as the total - confirm.")
        need("total")
    paid = labelled(rows, r"amount\s*paid|paid\s*amount|payments?\s*received|advance\s*paid|\bpaid\b", r"paid\s*to")
    tax = labelled(rows, r"\b(?:vat|gst|igst|cgst|sgst|tax)\b(?:\s*amount)?(?:[^\d\n]*?\d+(?:\.\d+)?\s*%\)?)?", r"tax\s*invoice|tax\s*(?:reg|id|no)|\bvat\s*(?:no|number|reg)|\btrn\b|total\s*(?:incl|excl)|before|taxable")
    freight = labelled(rows, aliases.pattern("freight"), r"delivery\s*(?:note|date|terms|address)|ship\s*to")
    disc = labelled(rows, r"(?:less\s*)?discount(?:\s*amount)?|\brebate\b", r"disc\w*\s*%?\s*$")
    other = labelled(rows, aliases.pattern("other_charges"))
    val = lambda t: t[0] if t else 0.0
    totals = {"subtotal": val(sub), "discount": abs(val(disc)), "tax": val(tax), "freight": val(freight), "other_charges": val(other),
              "total": val(grand), "paid": val(paid), "balance": val(balance) if grand is not balance else 0.0}
    for name, t in (("subtotal", sub), ("total", grand)):
        flag(name, t[1] if t else None, val(t), t[2] if t else None, t[3].bbox() if t else None)
    for name, t in (("tax", tax), ("freight", freight), ("discount", disc), ("other_charges", other), ("paid", paid), ("balance", balance)):
        if t:
            flag(name, t[1], totals.get(name), t[2], t[3].bbox())
    if used_ocr:
        for name, t in (("total", grand), ("subtotal", sub)):
            if t and t[1] < 0.9:
                need(name)

    rnd = lambda n: round(n * 100) / 100
    items_sum = rnd(sum(i["total"] for i in items))
    tax_sum = rnd(sum(i["tax"] for i in items))
    disc_sum = rnd(sum(i["discount"] for i in items))
    gross_sum = rnd(sum(i["quantity"] * i["unit_price"] for i in items))
    readings = {items_sum, rnd(items_sum - tax_sum), rnd(items_sum - tax_sum + disc_sum), rnd(items_sum + disc_sum), gross_sum}
    if items and sub and all(abs(r - sub[0]) > 0.05 for r in readings):
        need("subtotal")
        need("line_items")
        warnings.append(f"Line items add up to {items_sum:.2f} but the document subtotal reads {sub[0]:.2f} - please review.")
    if not sub and items:
        totals["subtotal"] = gross_sum if abs(gross_sum - items_sum) > 0.05 and tax_sum else items_sum
        need("subtotal")
        warnings.append("Subtotal was not found; it was calculated from line items.")
    if grand:
        expected = rnd(totals["subtotal"] + totals["tax"] + totals["freight"] + totals["other_charges"] - totals["discount"])
        if totals["subtotal"] and abs(expected - grand[0]) > 0.05:
            need("total")
            warnings.append(f"Total mismatch — please review. Subtotal − discount + freight + other charges + tax = {expected:.2f}, but the document total reads {grand[0]:.2f}.")
    else:
        need("total")
        warnings.append("Grand total was not found.")

    # VAT arithmetic: the printed rate applied to a plausible taxable base must give the printed VAT amount
    if tax and totals["tax"]:
        pm = re.search(r"(\d+(?:\.\d+)?)\s*%", tax[3].text)
        rate = float(pm[1]) if pm else None
        if rate is None and items and all(i["tax_rate"] for i in items) and len({i["tax_rate"] for i in items}) == 1:
            rate = items[0]["tax_rate"]
        if rate:
            s0, d0, f0, o0 = totals["subtotal"], totals["discount"], totals["freight"], totals["other_charges"]
            bases = {s0, s0 - d0, s0 - d0 + f0, s0 - d0 + f0 + o0, s0 + f0}
            if s0 and all(abs(b * rate / 100 - totals["tax"]) > max(0.05, totals["tax"] * 0.01) for b in bases):
                need("tax")
                warnings.append(f"VAT looks wrong: {rate:g}% of {s0 - d0:,.2f} is {(s0 - d0) * rate / 100:,.2f}, but the document shows {totals['tax']:,.2f} - please review.")

    empty_pages = [p.page for p in result.pages if not p.lines]
    if not rows:
        warnings.append("No text could be read from this file.")
    elif any(p.source == "ocr" and p.mean_conf < 0.55 for p in result.pages):
        warnings.append("OCR could not confidently read this document. Please review the highlighted fields.")
    if empty_pages and rows:
        warnings.append(f"No text was found on page(s) {', '.join(map(str, empty_pages))}.")

    confs = [r.conf for r in rows]
    amb = numbers.ambiguities()
    if amb:
        warnings.append(f"Number format is ambiguous ({amb[0]}{'; +%d more' % (len(amb) - 1) if len(amb) > 1 else ''}) - check the amounts against the original.")
        need("total")
    return {
        "status": "completed",
        "document_type": doc_type,
        "type_confidence": type_conf,
        "text": full,
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
        "number_style": number_style or "",
        "ambiguous_numbers": amb,
    }
