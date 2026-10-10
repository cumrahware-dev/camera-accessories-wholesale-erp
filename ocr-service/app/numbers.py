"""
Locale-aware money/number parsing. Never guesses silently: a token whose separators cannot be told apart
("1.366", "1,366") is parsed the literal way and reported as ambiguous so the reviewer is asked.

Handles 1,366,824.38  1.366.824,38  1 366 824,38  1'366'824.38  13,66,824.38  (1,234.50)  1,234.50-  -1.234,50
"""
from __future__ import annotations

import re
from contextvars import ContextVar
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

_SPACES = "\u00a0\u202f\u2009 "
_TOKEN = re.compile(r"\d[\d.,'\u00a0\u202f\u2009 ]*\d|\d")


@dataclass
class Parsed:
    value: Decimal | None
    ambiguous: bool = False
    note: str = ""


# per-document context: the decimal style learned from the document (or confirmed for the supplier), and the ambiguities hit
_STYLE: ContextVar[str | None] = ContextVar("num_style", default=None)
_AMBIG: ContextVar[list | None] = ContextVar("num_ambig", default=None)


def _digits_after(s: str, sep: str) -> int:
    return len(s) - s.rfind(sep) - 1


def parse_number(raw: str, style: str | None = None) -> Parsed:
    """style: 'dot' (1,234.56) or 'comma' (1.234,56) when known for the document; None = unknown."""
    if raw is None:
        return Parsed(None)
    s = str(raw).strip()
    neg = bool(re.match(r"^\(.*\)$", s)) or bool(re.match(r"^[^\d]*-\s*\d", s)) or bool(re.search(r"\d\s*-\s*$", s)) or bool(re.search(r"\bCR\b", s, re.I))
    m = _TOKEN.search(s)
    if not m:
        return Parsed(None)
    t = m.group(0).strip()
    t = re.sub(r"['\u00a0\u202f\u2009 ]+", "", t) if re.fullmatch(r"\d{1,3}(?:['\u00a0\u202f\u2009 ]\d{3})+(?:[.,]\d+)?", t) else t.replace(" ", "")
    t = t.replace("'", "")
    dots, commas = t.count("."), t.count(",")
    ambiguous, note = False, ""
    if dots and commas:
        dec = "." if t.rfind(".") > t.rfind(",") else ","
        thou = "," if dec == "." else "."
        body, frac = t.rsplit(dec, 1)
        if thou in frac or not re.fullmatch(r"\d{1,3}(?:%s\d{2,3})*" % re.escape(thou), body) or not frac.isdigit():
            return Parsed(None, True, "inconsistent separators")
        t = body.replace(thou, "") + "." + frac
    elif dots or commas:
        sep = "." if dots else ","
        n = dots or commas
        other_style = "comma" if sep == "." else "dot"
        if n > 1:
            # repeated separator can only be thousands grouping
            if not re.fullmatch(r"\d{1,3}(?:%s\d{2,3})+" % re.escape(sep), t):
                return Parsed(None, True, "inconsistent grouping")
            t = t.replace(sep, "")
        else:
            after = _digits_after(t, sep)
            before = t.index(sep)
            if after == 3 and 1 <= before <= 3:
                # "1.366" / "1,366": decimal or thousands?
                sep_is_decimal_style = "dot" if sep == "." else "comma"
                if style == sep_is_decimal_style:
                    t = t.replace(sep, ".")  # decimal
                elif style == other_style:
                    t = t.replace(sep, "")  # thousands
                else:
                    ambiguous, note = True, f"'{t}' can be read as {t.replace(sep, '.')} or {t.replace(sep, '')}"
                    # literal reading: a comma before exactly three digits is thousands, a dot is a decimal point
                    t = t.replace(sep, "") if sep == "," else t
            else:
                t = t.replace(sep, ".")
    try:
        v = Decimal(t)
    except InvalidOperation:
        return Parsed(None)
    return Parsed(-v if neg else v, ambiguous, note)


def detect_style(text: str) -> str | None:
    """'dot' or 'comma' from the numbers that cannot be read two ways. None when absent or the document mixes both."""
    dot = comma = 0
    for m in _TOKEN.finditer(text):
        t = re.sub(r"['\u00a0\u202f\u2009 ]", "", m.group(0))
        d, c = t.count("."), t.count(",")
        if d and c:
            if t.rfind(".") > t.rfind(","): dot += 1
            else: comma += 1
        elif d > 1: comma += 1          # 1.366.824 -> dots are thousands
        elif c > 1: dot += 1
        elif d == 1 and _digits_after(t, ".") in (1, 2): dot += 1
        elif c == 1 and _digits_after(t, ",") in (1, 2): comma += 1
    if dot and comma:
        # a few stray tokens (an address, a reference) must not flip a document that is clearly one style
        return "dot" if dot >= 4 * comma else "comma" if comma >= 4 * dot else None
    return "dot" if dot else "comma" if comma else None


def begin_document(text: str, preferred: str | None = None):
    """Starts a fresh numeric context for one document. `preferred` is a supplier style a person confirmed earlier."""
    style = preferred if preferred in ("dot", "comma") else detect_style(text)
    _STYLE.set(style)
    _AMBIG.set([])
    return style


def ambiguities() -> list[str]:
    return list(_AMBIG.get() or [])


def parse_float(raw: str) -> float | None:
    """Float for the legacy callers, using (and recording against) the current document context."""
    p = parse_number(raw, _STYLE.get())
    if p.ambiguous:
        bucket = _AMBIG.get()
        if bucket is not None and p.note not in bucket:
            bucket.append(p.note)
    return None if p.value is None else float(p.value)
