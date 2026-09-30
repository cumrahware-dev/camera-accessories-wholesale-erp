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
    max_pages: int = field(default_factory=lambda: _int("OCR_MAX_PAGES", 30))
    max_concurrency: int = field(default_factory=lambda: _int("OCR_MAX_CONCURRENCY", 1))
    render_dpi: int = field(default_factory=lambda: _int("OCR_RENDER_DPI", 200))
    lang: str = field(default_factory=lambda: os.environ.get("PADDLEOCR_LANG", "en"))
    # Comma separated browser origins allowed to call the service. Empty = CORS disabled
    # (the ERP calls it server-to-server, so browsers should never talk to it directly).
    allowed_origins: tuple = field(
        default_factory=lambda: tuple(o.strip() for o in os.environ.get("OCR_ALLOWED_ORIGINS", "").split(",") if o.strip())
    )
