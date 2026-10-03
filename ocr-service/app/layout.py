"""Positional view of a read document: rows of cells (with word boxes), plus label → value lookup by geometry."""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .engine import Line
from .reader import ReadResult


@dataclass
class Row:
    text: str
    conf: float          # weakest cell on the row
    page: int
    mean: float = 1.0    # average over the row's cells
    cells: list = field(default_factory=list)   # Line objects, left to right
    y0: float = 0.0
    y1: float = 0.0
    pw: float = 1.0      # page width / height (same units as the boxes)
    ph: float = 1.0

    def bbox(self, cells: list | None = None) -> dict:
        cs = cells or self.cells
        if not cs:
            return {}
        x0, y0 = min(c.x0 for c in cs), min(c.y0 for c in cs)
        x1, y1 = max(c.x1 for c in cs), max(c.y1 for c in cs)
        return box(self.page, x0, y0, x1, y1, self.pw, self.ph)


def box(page: int, x0: float, y0: float, x1: float, y1: float, pw: float, ph: float) -> dict:
    """Normalised (0..1) box so the ERP can draw it on any rendering of the page."""
    pw, ph = max(pw, 1.0), max(ph, 1.0)
    return {"page": page, "x0": round(x0 / pw, 4), "y0": round(y0 / ph, 4), "x1": round(x1 / pw, 4), "y1": round(y1 / ph, 4)}


def to_rows(result: ReadResult) -> list[Row]:
    rows: list[Row] = []
    for pg in result.pages:
        pw = float(pg.width or max((l.x1 for l in pg.lines), default=1.0))
        ph = float(pg.height or max((l.y1 for l in pg.lines), default=1.0))
        # Cells with no letters or digits (".", "|", table-border debris) are OCR noise.
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
            rows.append(Row("  ".join(x.text.strip() for x in g), min(x.conf for x in g), pg.page, sum(x.conf for x in g) / len(g),
                            g, min(x.y0 for x in g), max(x.y1 for x in g), pw, ph))
    return rows


SEP = r"[\s:.#\-–]*"


def labeled_value(rows: list[Row], label: str, value: str, *, exclude: str | None = None, max_rows: int | None = None,
                  below: bool = True) -> tuple[str, float, Row, Line] | None:
    """Find `label` and return the value next to it: in the same cell, in the next cell to the right on the same row,
    or in the cell directly below (stacked layouts). Returns (value, confidence, row, cell)."""
    lab = re.compile(label, re.I)
    val = re.compile(r"^" + SEP + r"(" + value + r")", re.I)
    exc = re.compile(exclude, re.I) if exclude else None
    scan = rows if max_rows is None else rows[:max_rows]
    for ri, r in enumerate(scan):
        for ci, cell in enumerate(r.cells):
            m = lab.search(cell.text)
            if not m or (exc and exc.search(cell.text[max(0, m.start() - 12): m.end() + 2])):
                continue
            rest = cell.text[m.end():]
            v = val.match(rest)
            if v and v.group(1).strip():
                return v.group(1).strip(), cell.conf, r, cell
            if rest.strip(" :.#-"):
                continue  # something else follows the label in this cell (e.g. "Invoice No. of items")
            # next cell to the right on the same row
            for nxt in r.cells[ci + 1: ci + 2]:
                v = val.match(nxt.text)
                if v and v.group(1).strip():
                    return v.group(1).strip(), min(cell.conf, nxt.conf), r, nxt
            if not below:
                continue
            # the cell directly below the label (overlapping horizontally), within the next two rows of the same page
            for r2 in rows[ri + 1: ri + 3]:
                if r2.page != r.page:
                    break
                for c2 in r2.cells:
                    if c2.x1 >= cell.x0 - 5 and c2.x0 <= cell.x1 + 40:
                        v = val.match(c2.text)
                        if v and v.group(1).strip():
                            return v.group(1).strip(), min(cell.conf, c2.conf), r2, c2
    return None
