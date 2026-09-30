"""
OCR engines. The rest of the service depends only on the small `OcrEngine` interface, so Tesseract can be
replaced (or joined by another engine) by adding a class here and selecting it in `build_engine`.

Tesseract is driven as a short-lived CPU subprocess per page: no model stays resident in the API process,
and the OS returns all of its memory the moment the page is done.
"""
from __future__ import annotations

import io
import os
import re
import shutil
import subprocess
from dataclasses import dataclass, field
from typing import Protocol

from PIL import Image


@dataclass
class Line:
    text: str
    conf: float  # 0..1
    x0: float
    y0: float
    x1: float
    y1: float


@dataclass
class PageOcr:
    lines: list[Line] = field(default_factory=list)
    words: int = 0
    mean_conf: float = 0.0  # 0..100 over words, like Tesseract reports it
    good_words: int = 0     # words read with confidence >= 60: used to pick the better of two passes


class EngineUnavailable(RuntimeError):
    pass


class OcrEngine(Protocol):
    name: str

    def recognize(self, img: Image.Image, timeout: float) -> PageOcr:
        """Read one page image (mode L or RGB) and return text lines with confidence and bounding boxes."""
        ...

    def orientation(self, img: Image.Image, timeout: float) -> int:
        """Degrees (0/90/180/270) the page must be rotated clockwise to be upright, 0 if unknown."""
        ...


class TesseractEngine:
    name = "Tesseract"

    def __init__(self, cmd: str = "tesseract", langs: str = "eng", psm: int = 4):
        self.cmd, self.langs, self.psm = cmd, langs, psm
        self._checked = False

    # ── availability ────────────────────────────────────────────────────────
    def check(self) -> str:
        """Verify the binary and the requested language files once; returns the version string."""
        path = shutil.which(self.cmd)
        if not path:
            raise EngineUnavailable("Tesseract is not installed on the OCR server.")
        try:
            out = subprocess.run([path, "--list-langs"], capture_output=True, text=True, timeout=15)
            have = set(out.stdout.split()[1:]) | set(out.stderr.split())
            missing = [l for l in self.langs.split("+") if l not in have]
            if missing:
                raise EngineUnavailable(f"Tesseract language data missing: {', '.join(missing)}")
            ver = subprocess.run([path, "--version"], capture_output=True, text=True, timeout=15)
            self._checked = True
            return (ver.stdout or ver.stderr).splitlines()[0]
        except subprocess.TimeoutExpired as exc:
            raise EngineUnavailable("Tesseract did not respond.") from exc

    # ── plumbing ────────────────────────────────────────────────────────────
    def _run(self, img: Image.Image, args: list[str], timeout: float) -> str:
        buf = io.BytesIO()
        img.save(buf, format="PNG", compress_level=1)
        env = {**os.environ, "OMP_THREAD_LIMIT": "1", "OMP_NUM_THREADS": "1"}  # one core: predictable CPU and RAM
        try:
            proc = subprocess.run(
                [self.cmd, "stdin", "stdout", *args], input=buf.getvalue(), capture_output=True,
                timeout=max(1.0, timeout), env=env, preexec_fn=lambda: os.nice(5),
            )
        except FileNotFoundError as exc:
            raise EngineUnavailable("Tesseract is not installed on the OCR server.") from exc
        except subprocess.TimeoutExpired as exc:
            raise TimeoutError("OCR timed out") from exc
        finally:
            buf.close()
        if proc.returncode != 0:
            raise RuntimeError("tesseract failed")  # stderr may echo image data paths; keep it out of messages
        return proc.stdout.decode("utf-8", "replace")

    def recognize(self, img: Image.Image, timeout: float) -> PageOcr:
        tsv = self._run(img, ["-l", self.langs, "--oem", "1", "--psm", str(self.psm), "tsv"], timeout)
        return parse_tsv(tsv)

    def orientation(self, img: Image.Image, timeout: float) -> int:
        try:
            out = self._run(img, ["--psm", "0", "-l", "osd"], timeout)
        except Exception:
            return 0
        m = re.search(r"Rotate:\s*(\d+)", out)
        return int(m.group(1)) if m else 0


def parse_tsv(tsv: str) -> PageOcr:
    """Words -> lines. A line is split into separate boxes wherever there is a wide horizontal gap
    (table columns, left/right headers) so the parser sees them as distinct cells."""
    words: dict[tuple, list] = {}
    n = 0
    total = 0.0
    good = 0
    for row in tsv.splitlines()[1:]:
        p = row.split("\t")
        if len(p) < 12 or p[0] != "5":
            continue
        text = p[11].strip()
        try:
            conf = float(p[10])
        except ValueError:
            continue
        if not text or conf < 0:
            continue
        x, y, w, h = int(p[6]), int(p[7]), int(p[8]), int(p[9])
        words.setdefault((p[2], p[3], p[4]), []).append((x, y, x + w, y + h, text, conf))
        n += 1
        total += conf
        good += conf >= 60
    lines: list[Line] = []
    for ws in words.values():
        ws.sort()
        height = max(w[3] - w[1] for w in ws)
        seg = [ws[0]]
        for prev, cur in zip(ws, ws[1:]):
            if cur[0] - prev[2] > 1.6 * height:  # wide gap: new cell
                lines.append(_line(seg))
                seg = []
            seg.append(cur)
        lines.append(_line(seg))
    return PageOcr(lines=lines, words=n, mean_conf=(total / n if n else 0.0), good_words=good)


def _line(ws: list) -> Line:
    conf = sum(w[5] for w in ws) / len(ws) / 100.0
    return Line(" ".join(w[4] for w in ws), round(conf, 3), min(w[0] for w in ws), min(w[1] for w in ws), max(w[2] for w in ws), max(w[3] for w in ws))


def build_engine(langs: str = "eng", cmd: str = "tesseract", psm: int = 4) -> OcrEngine:
    name = os.environ.get("OCR_ENGINE", "tesseract").lower()
    if name == "tesseract":
        return TesseractEngine(cmd, langs, psm)
    raise RuntimeError(f"Unknown OCR_ENGINE '{name}'")
