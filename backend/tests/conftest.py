import hashlib
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


# Set ORDER_AGENT_TEST_POSTGRES to an admin URL (for example postgresql://postgres@localhost:5432/postgres) to run the
# whole suite against Postgres instead of SQLite. Each test gets its own throwaway database.
PG_ADMIN = os.environ.get("ORDER_AGENT_TEST_POSTGRES")


def _pg_database_for(data_dir: Path, created: list[str]) -> str:
    import psycopg
    from psycopg import sql
    name = "t_" + hashlib.sha1(str(data_dir).encode()).hexdigest()[:20]
    with psycopg.connect(PG_ADMIN, autocommit=True) as admin:
        if not admin.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,)).fetchone():
            admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
            created.append(name)
    return PG_ADMIN.rsplit("/", 1)[0] + "/" + name


@pytest.fixture
def make_client(tmp_path, monkeypatch):
    """Build a fresh app on its own database. Call again with the same folder to simulate a restart."""
    from app.config import load_settings
    from app.main import create_app

    created: list[str] = []

    def factory(extractor: str = "test", data_dir: Path | None = None, **env):
        folder = data_dir or tmp_path
        monkeypatch.setenv("ORDER_AGENT_DATA_DIR", str(folder))
        monkeypatch.setenv("ORDER_AGENT_EXTRACTOR", extractor)
        if PG_ADMIN:
            monkeypatch.setenv("DATABASE_URL", _pg_database_for(folder, created))
        else:
            monkeypatch.delenv("DATABASE_URL", raising=False)
            monkeypatch.delenv("POSTGRES_URL", raising=False)
        for key, value in env.items():
            monkeypatch.setenv(key, value)
        return TestClient(create_app(load_settings()))

    yield factory
    if created:
        import psycopg
        from psycopg import sql
        with psycopg.connect(PG_ADMIN, autocommit=True) as admin:
            for name in created:
                admin.execute(sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(name)))
