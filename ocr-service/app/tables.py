"""Line-item tables reconstructed from word positions.

1. Find the header row and turn its words into columns (type + x-range), whatever their order.
2. For every following row, put each word into a column by its position (left edge for text, right or left edge
   for numbers), join wrapped description lines, and read numbers per column.
3. Check qty × price (− discount, + tax) against the line amount. Nothing is corrected silently: rows that do not
   add up are returned with consistent=False so they are flagged for review.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from . import aliases
from .layout import Row

NUMERIC = {"qty", "price", "disc", "taxpct", "tax", "amount", "sl"}
STOP_RE = re.compile(r"^\s*(sub\s*-?\s*total|total\b|grand\s*total|net\s*total|amount\s*(?:due|payable|in\s*words)|balance|"
                     r"invoice\s*total|taxable|vat\s*\(|vat\s*:|tax\s*:|freight|shipping|discount\s*:|terms|notes?\b|bank|amount\s*chargeable|"
                     r"this is a computer)", re.I)
SKIP_RE = re.compile(r"^\s*(continued|page\s*\d+|carried\s*forward|c/f|b/f|brought\s*forward)", re.I)
NUM_TOKEN = re.compile(r"^[-(]?(?:[A-Z]{3}|[$€£₹]|Rs\.?)?\s*-?\d[\d.,]*%?\)?$", re.I)


@dataclass
class Column:
    kind: str
    x0: float
    x1: float
    label: str
    pct: bool = False


def _words(row: Row) -> list[tuple[str, float, float, float]]:
    out = []
    for c in row.cells:
        if c.words:
            out.extend(c.words)
        else:  # engines without word boxes: spread the cell's words evenly
            parts = c.text.split()
            if not parts:
                continue
            step = (c.x1 - c.x0) / len(parts)
            out.extend((p, c.x0 + i * step, c.x0 + (i + 1) * step, c.conf) for i, p in enumerate(parts))
    return sorted(out, key=lambda w: w[1])


def header_columns(row: Row) -> list[Column] | None:
    pats = aliases.column_patterns()
    order = ["sku", "taxpct", "price", "amount", "disc", "tax", "qty", "uom", "desc", "sl"]  # tie-break for ambiguous single words
    ws = _words(row)
    cols: list[Column] = []
    i = 0
    while i < len(ws):
        hit = None
        for j in range(min(len(ws), i + 4), i, -1):  # longest phrase first: "Unit Price" before "Unit"
            phrase = " ".join(w[0] for w in ws[i:j]).strip(" :.")
            if j - i > 1 and ws[j - 1][1] - ws[j - 2][2] > 2.5 * max(4.0, (ws[j - 2][2] - ws[j - 2][1]) / max(1, len(ws[j - 2][0]))):
                continue  # words too far apart to be one label
            for k in order:
                if pats[k].match(phrase):
                    hit = (k, j, phrase)
                    break
            if hit:
                break
        if hit:
            k, j, phrase = hit
            cols.append(Column(k, ws[i][1], ws[j - 1][2], phrase, "%" in phrase))
            i = j
        else:
            if cols and ws[i][1] - cols[-1].x1 < 12:
                cols[-1].x1 = ws[i][2]  # unknown trailing word of the previous label
            i += 1
    kinds = [c.kind for c in cols]
    if len(cols) < 3 or not ({"desc", "sku"} & set(kinds)) or not ({"qty", "price", "amount"} & set(kinds)) or len({"qty", "price", "amount"} & set(kinds)) < 2:
        return None
    # the same kind twice ("Amount" and "Total"): keep the right-most as the line amount
    seen: dict[str, int] = {}
    for idx, c in enumerate(cols):
        if c.kind in seen and c.kind == "amount":
            cols[seen[c.kind]].kind = "tax" if "tax" not in kinds else "other"
        seen[c.kind] = idx
    return cols


def is_header(row: Row) -> bool:
    return header_columns(row) is not None


def _assign(word, cols: list[Column]) -> int:
    t, x0, x1, _ = word
    tol = 6.0
    left = max((i for i, c in enumerate(cols) if x0 >= c.x0 - tol), default=0)
    right = next((i for i, c in enumerate(cols) if x1 <= c.x1 + tol), len(cols) - 1)
    if left == right:
        return left
    numeric = bool(NUM_TOKEN.match(t))
    if numeric:
        cand = [i for i in (left, right) if cols[i].kind in NUMERIC]
        if len(cand) == 1:
            c = cols[cand[0]]
            other = left if cand[0] == right else right
            # "HDMI cable 2.1 (per metre)": a number well clear of the numeric column belongs to the text beside it
            if cols[other].kind not in NUMERIC and (x1 < c.x0 - 12 or x0 > c.x1 + 12):
                return other
            return cand[0]
        cx = (x0 + x1) / 2
        return min((left, right), key=lambda i: abs((cols[i].x0 + cols[i].x1) / 2 - cx))
    return left


def num(s: str) -> float | None:
    from .extractor import parse_amount
    s = s.strip().replace("(", "-").replace(")", "")
    if not re.search(r"\d", s):
        return None
    return parse_amount(s)


def with_description(cols: list[Column]) -> list[Column]:
    """The header word for the description column can be unreadable. The text between the row number / SKU and the
    first numeric column is still the description: give it a column instead of letting it fall into the wrong one."""
    if any(c.kind == "desc" for c in cols) or len(cols) < 3:
        return cols
    width = max(c.x1 for c in cols) or 1.0
    ordered = sorted(cols, key=lambda c: c.x0)
    best = None
    for a, b in zip(ordered, ordered[1:]):
        if a.kind not in ("sl", "sku") or b.kind == "sl":
            continue
        gap = b.x0 - a.x1
        if gap >= 0.06 * width and (best is None or gap > best[0]):
            best = (gap, a.x1, b.x0)
    if best is None:
        return cols
    return sorted(cols + [Column("desc", best[1] + 2, best[2] - 2, "(description)")], key=lambda c: c.x0)


_CASE_EDGE = re.compile(r"(?<=[a-z0-9])(?=[A-Z][a-z])|(?<=[0-9])(?=[A-Z]{2,})|(?<=[A-Z0-9])(?=[A-Z][a-z])")


def split_crossing(cw: list, cols: list[Column]) -> list:
    """PDF text layers glue neighbouring cells when a long SKU runs into the description ("A019-24-DGDNSigma").
    A text word that spans the start of the next text column is cut where its width says the boundary is, snapped to
    the nearest letter-case / digit boundary. If no such boundary is near, the word is left alone."""
    out = []
    text_cols = [c for c in cols if c.kind in ("desc", "sku")]
    for w in cw:
        t, x0, x1, conf = w
        if NUM_TOKEN.match(t) or len(t) < 6:
            out.append(w); continue
        cut = None
        for c in text_cols:
            if x0 < c.x0 - 6 and x1 > c.x0 + 10:
                cut = c.x0
                break
        if cut is None:
            out.append(w); continue
        idx = round((cut - x0) / (x1 - x0) * len(t))
        edges = [m.start() for m in _CASE_EDGE.finditer(t)]
        near = [e for e in edges if abs(e - idx) <= 2 and e > 0]
        if not near:
            out.append(w); continue
        e = min(near, key=lambda e: abs(e - idx))
        mid = x0 + (x1 - x0) * e / len(t)
        out.append((t[:e], x0, mid, conf)); out.append((t[e:], mid, x1, conf))
    return out


def parse_rows(rows: list[Row], start: int, cols: list[Column]):
    """Returns (items, last_index_used). Each item is (dict, consistent, conf, row)."""
    items: list = []
    last = start
    cols = with_description(cols)
    kinds = [c.kind for c in cols]
    i = start
    while i < len(rows):
        r = rows[i]
        t = r.text
        if SKIP_RE.match(t):
            i += 1
            continue
        if STOP_RE.match(r.cells[0].text if r.cells else t) and items:
            break
        nh = header_columns(r)
        if nh:  # header repeated on the next page: continue with its column positions
            cols = with_description(nh)
            kinds = [c.kind for c in cols]
            i += 1
            continue
        if i > start and items and r.page != items[-1][3].page and not nh:
            pass
        buckets: dict[int, list] = {}
        for cell in r.cells:
            cw = cell.words or [(p, cell.x0, cell.x1, cell.conf) for p in cell.text.split()]
            # a row number printed left of the first column ("1", "2.") is not part of the description or SKU
            cw = split_crossing(cw, cols)
            if cols[0].kind in ("desc", "sku") and cw and re.fullmatch(r"\d{1,3}\.?", cw[0][0]) and cw[0][2] <= cols[0].x0 - 4:
                cw = cw[1:]
                if not cw:
                    continue
            first = _assign(cw[0], cols) if cw else 0
            if cols[first].kind == "desc" and not any(NUM_TOKEN.match(w[0]) for w in cw):
                buckets.setdefault(first, []).extend(cw)  # description text spilling past its column stays in it
                continue
            for w in cw:
                buckets.setdefault(_assign(w, cols), []).append(w)
        # table-border debris ("_", "|", "=", quotes) is not text
        text_of = lambda k: " ".join(w[0].strip("_|=~`'\"‘’“”") for idx in range(len(cols)) if cols[idx].kind == k
                                     for w in buckets.get(idx, []) if re.search(r"[A-Za-z0-9]", w[0]))

        def number_of(k: str) -> float | None:
            for idx, c in enumerate(cols):
                if c.kind != k or idx not in buckets:
                    continue
                toks = [w[0] for w in buckets[idx]]
                joined = "".join(toks) if re.fullmatch(r"\d{1,3}(?: \d{3})+(?:[.,]\d+)?", " ".join(toks)) else toks[-1]
                return num(joined.replace("%", ""))
            return None

        qty, price, amount = number_of("qty"), number_of("price"), number_of("amount")
        desc = text_of("desc").strip()
        sku = text_of("sku").replace(" ", "").strip(".,:;-_")
        has_numbers = sum(v is not None for v in (qty, price, amount)) >= 2
        if not has_numbers:
            # wrapped description: text only, inside the description column, right after an item
            if items and desc and not any(buckets.get(idx) for idx, c in enumerate(cols) if c.kind in NUMERIC and c.kind != "sl") \
                    and i == last + 1 and not STOP_RE.match(t):
                items[-1][0]["description"] += " " + desc
                last = i
            i += 1
            continue
        if not desc and not sku:
            i += 1
            continue
        disc = number_of("disc") or 0.0
        taxpct = number_of("taxpct")
        tax = number_of("tax") or 0.0
        # never derive qty or price from the amount: that would "reconcile" by construction
        if amount is None and qty is not None and price is not None and "amount" not in kinds:
            amount = round(qty * price - disc + tax, 2)
        pre_recovered = False
        if qty is None or price is None or amount is None or qty <= 0 or "qty" not in kinds:
            solved = solve_row(_words(r))  # header words lost (e.g. "Qty" unreadable): rebuild from the row's arithmetic
            if not solved:
                i += 1
                continue
            qty, price, amount, disc, tax, desc2, sku2 = solved
            desc, sku, pre_recovered = desc2 or desc, sku or sku2, True
        gross = qty * price
        disc_col = next((c for c in cols if c.kind == "disc"), None)
        if disc_col and disc_col.pct and disc:
            disc = round(gross * disc / 100, 2)
        if taxpct is not None and not tax:
            tax = round((gross - disc) * taxpct / 100, 2) if "amount" in kinds and abs(amount - (gross - disc)) > 0.02 else 0.0
        candidates = {gross, gross - disc, gross - disc + tax, gross + tax}
        consistent = any(abs(v - amount) <= max(0.02, abs(amount) * 0.005) for v in candidates)
        recovered = pre_recovered
        if not consistent and not pre_recovered:
            solved = solve_row(_words(r))
            if solved:
                qty, price, amount, disc, tax, desc2, sku2 = solved
                desc, sku = desc or desc2, sku or sku2
                gross = qty * price
                consistent, recovered = True, True
        if "sku" in kinds and not sku:
            consistent = False
        if qty > 100000:
            consistent = False
        rate = taxpct if taxpct is not None else (round(tax / (gross - disc) * 100, 2) if tax > 0 and gross - disc > 0 else 0.0)
        # the weakest word among the values that matter (SKU, qty, price, amount) decides the item confidence
        crit = [w[3] for idx, b in buckets.items() if cols[idx].kind in ("sku", "qty", "price", "amount") for w in b if re.search(r"[A-Za-z0-9]", w[0])]
        conf = min(crit) if crit else r.mean
        if recovered:
            conf = min(conf, 0.84)  # read by arithmetic, not by column: show it for review
        item = {"description": desc or sku, "sku": sku, "quantity": int(qty) if float(qty).is_integer() else qty,
                "unit": text_of("uom"), "unit_price": price, "discount": disc, "tax_rate": rate, "tax": tax, "total": amount}
        if recovered:
            item["recovered"] = True
        items.append((item, consistent, conf, r))
        last = i
        i += 1
    return items, last


CODE_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9\-_./]{2,}")


def solve_row(words) -> tuple | None:
    """Recover (qty, price, amount, disc, tax, desc, sku) from a row's numbers alone: the amount is the last number,
    qty × price (− discount, + tax) must reproduce it exactly. Used only when the column layout does not add up."""
    toks = [(w[0], num(w[0].replace("%", ""))) for w in words]
    nums = [(i, v) for i, (t, v) in enumerate(toks) if v is not None and NUM_TOKEN.match(t)]
    last_alpha = max((i for i, (t, _) in enumerate(toks) if re.search(r"[A-Za-z]{2}", t)), default=-1)
    # numbers inside the description ("Manfrotto 190 Carbon") are never quantities or prices
    nums = [(i, v) for i, v in nums if i > last_alpha]
    if len(nums) < 3:
        return None
    ai, amount = nums[-1]
    best = None
    for a in range(len(nums) - 1):
        qi, qty = nums[a]
        if qty <= 0 or qty > 100000:
            continue
        for b in range(a + 1, len(nums) - 1):
            pi, price = nums[b]
            if price <= 0:
                continue
            gross = qty * price
            extras = [v for _, v in nums[b + 1: -1]]
            options = [(0.0, 0.0)] + [(d, 0.0) for d in extras] + [(0.0, t) for t in extras] + [(d, t) for d in extras for t in extras if d is not t]
            for d, t in options:
                if abs(gross - d + t - amount) <= max(0.02, amount * 0.002):
                    score = (d == 0) + (t == 0)
                    if best is None or score > best[0]:
                        best = (score, qi, qty, price, d, t)
                    break
    if not best:
        return None
    _, qi, qty, price, d, t = best
    text = [w for w, _ in toks[:qi] if not re.fullmatch(r"\d{1,3}\.?", w) or toks.index((w, _)) > 0]
    text = [w for w, _ in toks[:qi]]
    if text and re.fullmatch(r"\d{1,3}\.?", text[0]):
        text = text[1:]  # serial number
    sku = ""
    if text and CODE_RE.fullmatch(text[-1]) and re.search(r"\d|-", text[-1]) and len(text) > 1:
        sku = text.pop()
    return qty, price, amount, d, t, " ".join(text), sku
