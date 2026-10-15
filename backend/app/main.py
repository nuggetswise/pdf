"""PDF Order Agent backend (prototype). Local only; no live ERP, marketplace or mailbox."""
from __future__ import annotations

from fastapi import FastAPI

from .config import load_settings

app = FastAPI(title="PDF Order Agent (prototype)")


@app.get("/api/health")
def health() -> dict:
    settings = load_settings()
    return {
        "status": "ok",
        "extraction": "available" if settings.extraction_available else "unavailable",
        "erp": "local simulator",
    }
