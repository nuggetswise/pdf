"""Settings read from environment variables (and an optional local .env). Secrets never have defaults."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def load_dotenv(path: Path = ROOT / ".env") -> None:
    """Minimal .env reader. Existing environment variables win. Values are never logged."""
    if os.environ.get("ORDER_AGENT_LOAD_DOTENV") == "0" or not path.is_file():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        if value.strip():
            os.environ.setdefault(key.strip(), value.strip())


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    gemini_api_key: str | None
    gemini_model: str | None
    gemini_fallback_model: str | None
    extractor_mode: str
    max_upload_bytes: int

    @property
    def extraction_available(self) -> bool:
        if self.extractor_mode == "test":
            return True
        return bool(self.gemini_api_key and self.gemini_model)

    def __repr__(self) -> str:  # never print the key
        return f"Settings(data_dir={self.data_dir}, model={self.gemini_model}, mode={self.extractor_mode})"


def load_settings() -> Settings:
    load_dotenv()
    return Settings(
        data_dir=Path(os.environ.get("ORDER_AGENT_DATA_DIR") or ROOT / "data"),
        gemini_api_key=os.environ.get("GEMINI_API_KEY") or None,
        gemini_model=os.environ.get("GEMINI_MODEL") or None,
        gemini_fallback_model=os.environ.get("GEMINI_FALLBACK_MODEL") or None,
        extractor_mode=os.environ.get("ORDER_AGENT_EXTRACTOR", "gemini"),
        max_upload_bytes=int(os.environ.get("ORDER_AGENT_MAX_UPLOAD_BYTES") or 10 * 1024 * 1024),
    )
