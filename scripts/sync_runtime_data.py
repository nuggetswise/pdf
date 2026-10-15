#!/usr/bin/env python3
"""Copy the fixture files the running app needs into backend/runtime_data/, so the backend is self-contained
(for example when deployed on its own). Source of truth stays in fixtures/. A backend test fails if they drift.
Usage: python3 scripts/sync_runtime_data.py"""
from __future__ import annotations

import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "backend" / "runtime_data"


def sync() -> list[str]:
    OUT.mkdir(parents=True, exist_ok=True)
    wanted = {"reference-data.v1.json": ROOT / "fixtures" / "reference-data.v1.json"}
    for eml in sorted((ROOT / "fixtures" / "demo" / "generated").glob("*.eml")):
        wanted[f"demo/{eml.name}"] = eml
    (OUT / "demo").mkdir(exist_ok=True)
    for stale in (OUT / "demo").glob("*.eml"):
        if f"demo/{stale.name}" not in wanted:
            stale.unlink()
    for name, src in wanted.items():
        shutil.copyfile(src, OUT / name)
    return sorted(wanted)


if __name__ == "__main__":
    print(f"Synced {len(sync())} files into {OUT.relative_to(ROOT)}")
