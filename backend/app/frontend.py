import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles


def static_file(root: Path, full_path: str) -> Path | None:
    base = root.resolve()
    candidate = (base / full_path).resolve()
    try:
        candidate.relative_to(base)
    except ValueError:
        return None
    if candidate.is_file():
        return candidate
    return None


def register_frontend(app: FastAPI, directory: str | None = None) -> None:
    raw = os.environ.get("STATIC_DIR") if directory is None else directory
    if not raw:
        return
    root = Path(raw)
    if not root.is_dir() or not (root / "index.html").is_file():
        return
    assets = root / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.api_route("/{full_path:path}", methods=["GET", "HEAD"], include_in_schema=False, response_model=None)
    def serve_frontend(full_path: str) -> FileResponse | JSONResponse:
        if full_path == "v1" or full_path.startswith("v1/"):
            return JSONResponse(status_code=404, content={"code": "not_found", "message": "This resource could not be found."})
        found = static_file(root, full_path)
        if found is not None:
            return FileResponse(found)
        return FileResponse(root / "index.html")
