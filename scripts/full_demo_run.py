"""Regenerate frontend/lib/domain/__fixtures__/full-demo-run.json: run the 15-step demo through the Python
prototype (same steps as scripts/read_models.py, TEST ADAPTER, throwaway data folder) and export its SQLite
state with scripts/export_run_state.py.

Usage (from the repository root):
  backend/.venv/bin/python scripts/full_demo_run.py [out.json]
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import read_models  # noqa: E402  (sets the TEST ADAPTER environment and data folder on import)
from export_run_state import export  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]


def main(out: Path) -> None:
    read_models.main(Path(tempfile.mkstemp(suffix=".json")[1]))
    dbs = list(Path(os.environ["ORDER_AGENT_DATA_DIR"]).rglob("*.sqlite3"))
    assert len(dbs) == 1, dbs
    out.write_text(json.dumps(export(dbs[0]), indent=1, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "frontend/lib/domain/__fixtures__/full-demo-run.json")
