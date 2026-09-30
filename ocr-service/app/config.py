"""Service configuration, read once from the environment. Nothing here has an insecure default."""
import os
from dataclasses import dataclass, field


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    api_key: str = field(default_factory=lambda: os.environ.get("OCR_API_KEY", "").strip())
    max_upload_bytes: int = field(default_factory=lambda: _int("OCR_MAX_UPLOAD_MB", 15) * 1024 * 1024)
    timeout_seconds: int = field(default_factory=lambda: _int("OCR_TIMEOUT_SECONDS", 120))
    max_pages: int = field(default_factory=lambda: _int("OCR_MAX_PAGES", 20))
    # Concurrent OCR jobs. 1 keeps peak memory at "one page + one Tesseract process".
    max_concurrency: int = field(default_factory=lambda: _int("OCR_MAX_CONCURRENCY", 1))
    # Requests allowed to wait behind the running job(s) before the service answers 429.
    max_queue: int = field(default_factory=lambda: _int("OCR_MAX_QUEUE", 4))
    render_dpi: int = field(default_factory=lambda: _int("OCR_RENDER_DPI", 200))
    # Longest image side, in pixels, ever handed to the OCR engine; bigger inputs are downscaled.
    max_image_side: int = field(default_factory=lambda: _int("OCR_MAX_IMAGE_SIDE", 3200))
    max_image_pixels: int = field(default_factory=lambda: _int("OCR_MAX_IMAGE_MPIXELS", 40) * 1_000_000)
    # Tesseract language codes joined with '+'. Only these language files are loaded.
    langs: str = field(default_factory=lambda: os.environ.get("OCR_LANGS", "eng"))
    tesseract_cmd: str = field(default_factory=lambda: os.environ.get("TESSERACT_CMD", "tesseract"))
    psm: int = field(default_factory=lambda: _int("OCR_PSM", 4))
    # A page whose first (cheap) pass reads with at least this mean word confidence (0-100) is accepted as is.
    good_confidence: int = field(default_factory=lambda: _int("OCR_GOOD_CONFIDENCE", 75))
    # Comma separated browser origins allowed to call the service. Empty = CORS disabled
    # (the ERP calls it server-to-server, so browsers should never talk to it directly).
    allowed_origins: tuple = field(
        default_factory=lambda: tuple(o.strip() for o in os.environ.get("OCR_ALLOWED_ORIGINS", "").split(",") if o.strip())
    )
