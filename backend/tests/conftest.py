import os
import sys
import tempfile
from pathlib import Path

# Tests never read the developer's .env or real keys, and never touch the real data folder.
os.environ["ORDER_AGENT_LOAD_DOTENV"] = "0"
os.environ.pop("GEMINI_API_KEY", None)
os.environ.pop("GEMINI_MODEL", None)
os.environ["ORDER_AGENT_DATA_DIR"] = tempfile.mkdtemp(prefix="order-agent-import-")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture
def make_client(tmp_path, monkeypatch):
    """Build a fresh app on its own data folder. Call again with the same folder to simulate a restart."""
    from app.config import load_settings
    from app.main import create_app

    def factory(extractor: str = "test", data_dir: Path | None = None, **env):
        monkeypatch.setenv("ORDER_AGENT_DATA_DIR", str(data_dir or tmp_path))
        monkeypatch.setenv("ORDER_AGENT_EXTRACTOR", extractor)
        for key, value in env.items():
            monkeypatch.setenv(key, value)
        return TestClient(create_app(load_settings()))

    return factory
