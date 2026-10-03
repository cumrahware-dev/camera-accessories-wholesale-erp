"""Configurable label dictionary (app/aliases.json, optionally extended by OCR_ALIASES_FILE)."""
from __future__ import annotations

import json
import os
import re
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def load() -> dict:
    data = json.loads((Path(__file__).with_name("aliases.json")).read_text("utf-8"))
    extra = os.environ.get("OCR_ALIASES_FILE", "").strip()
    if extra and Path(extra).is_file():
        more = json.loads(Path(extra).read_text("utf-8"))
        for k, v in more.items():
            if isinstance(v, list):
                data[k] = list(dict.fromkeys(data.get(k, []) + v))
            elif isinstance(v, dict):
                cols = data.setdefault(k, {})
                for ck, cv in v.items():
                    cols[ck] = list(dict.fromkeys(cols.get(ck, []) + cv))
    return data


def phrase(alias: str) -> str:
    """'invoice no' -> r'invoice\\s*no\\.?' : flexible spacing, optional trailing dot, word-bounded."""
    parts = [re.escape(p) for p in alias.strip().split()]
    body = r"\s*".join(parts)
    if alias[-1:].isalnum():
        body += r"\.?"
    lead = r"(?<![A-Za-z0-9])" if alias[:1].isalnum() else ""
    trail = r"(?![A-Za-z])" if alias[-1:].isalnum() else ""
    return lead + body + trail


def pattern(key: str) -> str:
    """Alternation of all aliases for a key, longest first (so 'invoice no' wins over 'no')."""
    items = load()[key]
    return "(?:" + "|".join(phrase(a) for a in sorted(items, key=len, reverse=True)) + ")"


def column_patterns() -> dict[str, re.Pattern]:
    cols = load()["columns"]
    return {k: re.compile("^(?:" + "|".join(phrase(a) for a in sorted(v, key=len, reverse=True)) + r")\s*[:.]?$", re.I) for k, v in cols.items()}
