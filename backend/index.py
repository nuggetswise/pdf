"""Vercel entrypoint. Deploy the `backend` folder as its own Vercel project (Root Directory = backend).
Everything is served by the FastAPI app in app/main.py; nothing here has logic."""
from app.main import app  # noqa: F401  (Vercel looks for a module-level `app`)
