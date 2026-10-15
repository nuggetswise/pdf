"""Settings read from environment variables (and an optional local .env). Secrets never have defaults."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = Path(__file__).resolve().parents[1]  # self-contained: runtime data lives under backend/


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
    database_url: str | None = None
    inline_processing: bool = False
    gemini_timeout: float = 45.0
    gemini_attempts: int = 4
    gemini_budget_seconds: float | None = None
    sweep_token: str | None = None

    @property
    def database_target(self):
        """Postgres URL when configured (hosted), otherwise the local SQLite file."""
        return self.database_url or self.data_dir / "order_agent.sqlite3"

    @property
    def extraction_available(self) -> bool:
        if self.extractor_mode == "test":
            return True
        return bool(self.gemini_api_key and self.gemini_model)

    def __repr__(self) -> str:  # never print the key
        return f"Settings(data_dir={self.data_dir}, model={self.gemini_model}, mode={self.extractor_mode})"


def load_settings() -> Settings:
    load_dotenv()
    hosted = bool(os.environ.get("VERCEL"))
    budget = os.environ.get("ORDER_AGENT_GEMINI_BUDGET_SECONDS")
    return Settings(
        data_dir=Path(os.environ.get("ORDER_AGENT_DATA_DIR") or (Path("/tmp/order-agent") if hosted else ROOT / "data")),
        gemini_api_key=os.environ.get("GEMINI_API_KEY") or None,
        gemini_model=os.environ.get("GEMINI_MODEL") or None,
        gemini_fallback_model=os.environ.get("GEMINI_FALLBACK_MODEL") or None,
        extractor_mode=os.environ.get("ORDER_AGENT_EXTRACTOR", "gemini"),
        max_upload_bytes=int(os.environ.get("ORDER_AGENT_MAX_UPLOAD_BYTES") or 10 * 1024 * 1024),
        database_url=os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL") or None,
        # Hosted functions cannot run work after the response, so process inside the request there.
        inline_processing=(os.environ.get("ORDER_AGENT_INLINE_PROCESSING", "1" if hosted else "0") == "1"),
        gemini_timeout=float(os.environ.get("ORDER_AGENT_GEMINI_TIMEOUT") or (25 if hosted else 45)),
        gemini_attempts=int(os.environ.get("ORDER_AGENT_GEMINI_ATTEMPTS") or (3 if hosted else 4)),
        gemini_budget_seconds=float(budget) if budget else (100.0 if hosted else None),
        sweep_token=os.environ.get("CRON_SECRET") or os.environ.get("ORDER_AGENT_SWEEP_TOKEN") or None,
    )
