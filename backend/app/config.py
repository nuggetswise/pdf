"""Settings read from environment variables. Secrets never have defaults."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    gemini_api_key: str | None
    gemini_model: str | None
    max_upload_bytes: int

    @property
    def extraction_available(self) -> bool:
        return bool(self.gemini_api_key and self.gemini_model)


def load_settings() -> Settings:
    return Settings(
        data_dir=Path(os.environ.get("ORDER_AGENT_DATA_DIR", ROOT / "data")),
        gemini_api_key=os.environ.get("GEMINI_API_KEY") or None,
        gemini_model=os.environ.get("GEMINI_MODEL") or None,
        max_upload_bytes=int(os.environ.get("ORDER_AGENT_MAX_UPLOAD_BYTES", 10 * 1024 * 1024)),
    )
