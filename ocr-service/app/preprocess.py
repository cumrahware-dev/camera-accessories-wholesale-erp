"""
Cheap, Pillow-only image preparation. Nothing here is applied blindly: the reader first tries the
lightest option and only escalates to `heavy` when Tesseract reports poor confidence.
"""
from __future__ import annotations

from PIL import Image, ImageChops, ImageFilter, ImageOps, ImageStat


def limit_size(img: Image.Image, max_side: int) -> Image.Image:
    """Downscale (never upscale) so the longest side is at most max_side."""
    long_side = max(img.size)
    if long_side <= max_side:
        return img
    scale = max_side / long_side
    return img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))), Image.LANCZOS)


def light(img: Image.Image) -> Image.Image:
    """Grayscale, plus contrast stretch only if the page is visibly washed out."""
    g = img if img.mode == "L" else img.convert("L")
    small = g.copy()
    small.thumbnail((256, 256))
    if ImageStat.Stat(small).stddev[0] < 45:
        g = ImageOps.autocontrast(g, cutoff=1)
    return g


def upscale_if_small(img: Image.Image, min_side: int = 1400, max_factor: float = 2.0) -> Image.Image:
    """Tesseract wants roughly 200-300 DPI text; tiny images are enlarged (bounded)."""
    long_side = max(img.size)
    if long_side >= min_side:
        return img
    f = min(max_factor, min_side / long_side)
    return img.resize((int(img.width * f), int(img.height * f)), Image.BICUBIC)


def estimate_skew(gray: Image.Image, max_angle: float = 6.0) -> float:
    """Projection-profile skew estimate on a small binary thumbnail (degrees, positive = counter-clockwise)."""
    thumb = gray.copy()
    thumb.thumbnail((520, 520))
    bw = thumb.point(lambda p: 255 if p < 160 else 0)

    def score(angle: float) -> float:
        rot = bw.rotate(angle, resample=Image.NEAREST, fillcolor=0)
        rows = list(rot.resize((1, rot.height), Image.BOX).tobytes())  # mean ink per row
        mean = sum(rows) / len(rows)
        return sum((r - mean) ** 2 for r in rows)

    best_a, best_s = 0.0, score(0.0)
    a = -max_angle
    while a <= max_angle:
        s = score(a)
        if s > best_s * 1.02:  # must be clearly better than "not skewed"
            best_a, best_s = a, s
        a += 0.5
    for d in (-0.4, -0.2, 0.2, 0.4):  # refine around the coarse optimum
        s = score(best_a + d)
        if s > best_s:
            best_a, best_s = best_a + d, s
    return best_a


def heavy(img: Image.Image) -> Image.Image:
    """Contrast + background flattening + denoise + deskew. Used only for pages that read poorly."""
    g = upscale_if_small(img if img.mode == "L" else img.convert("L"))
    g = ImageOps.autocontrast(g, cutoff=1)
    # Flatten uneven lighting / shadows: subtract a heavily blurred copy (the "background").
    radius = max(15, max(g.size) // 40)
    bg = g.filter(ImageFilter.BoxBlur(radius))
    flat = ImageChops.invert(ImageChops.subtract(bg, g))
    flat = ImageOps.autocontrast(flat, cutoff=2)
    flat = flat.filter(ImageFilter.MedianFilter(3))  # speckle / JPEG noise
    angle = estimate_skew(flat)
    if abs(angle) >= 0.3:
        flat = flat.rotate(angle, resample=Image.BICUBIC, expand=True, fillcolor=255)
    return flat


def rotate_upright(img: Image.Image, degrees_cw: int) -> Image.Image:
    if degrees_cw % 360 == 0:
        return img
    return img.rotate(-degrees_cw, expand=True, fillcolor=255)
