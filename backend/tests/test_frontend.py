from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.frontend import register_frontend, static_file


def _client(root: Path) -> TestClient:
    (root / "index.html").write_text("<html>lattice</html>", encoding="utf-8")
    assets = root / "assets"
    assets.mkdir()
    (assets / "app.js").write_text("console.log(1)", encoding="utf-8")
    app = FastAPI()
    register_frontend(app, str(root))
    return TestClient(app)


def test_backend_serves_the_frontend_shell_and_assets(tmp_path: Path) -> None:
    client = _client(tmp_path)
    assert "lattice" in client.get("/").text
    assert "lattice" in client.get("/login").text
    assert "lattice" in client.get("/sessions/checkout-demo").text
    script = client.get("/assets/app.js")
    assert script.status_code == 200
    assert script.text == "console.log(1)"
    missing = client.get("/v1/sessions")
    assert missing.status_code == 404
    assert missing.json()["code"] == "not_found"


def test_static_files_cannot_escape_the_frontend_directory(tmp_path: Path) -> None:
    root = tmp_path / "static"
    root.mkdir()
    secret = tmp_path / "secret.txt"
    secret.write_text("nope", encoding="utf-8")
    assert static_file(root, "../secret.txt") is None
    assert static_file(root, "missing.js") is None
