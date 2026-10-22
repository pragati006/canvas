import os

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

import json

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import session_scope
from app.main import app, hub, store
from app.tables import SessionRecord, UserRecord
from app.store import DEMO_EMAIL, DEMO_GUEST_TOKEN, DEMO_INTERVIEWER_EMAIL, DEMO_PASSWORD

client = TestClient(app)


def setup_function() -> None:
    store.reset()
    hub.reset()


def login(email: str = DEMO_EMAIL, password: str = DEMO_PASSWORD) -> str:
    response = client.post("/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["tokenType"] == "bearer"
    assert body["user"]["email"] == email
    return body["accessToken"]


def auth(token: str, actor: str = "user") -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "X-Lattice-Actor": actor}


def test_passwords_are_hashed_and_login_rejects_a_wrong_password() -> None:
    stored = json.dumps(store.users)
    assert DEMO_PASSWORD not in stored
    assert store.users[0]["passwordHash"].startswith("pbkdf2_sha256$")
    assert DEMO_GUEST_TOKEN not in json.dumps(store.guest_links)
    with session_scope() as db:
        hashes = list(db.scalars(select(UserRecord.password_hash)))
        stored_titles = list(db.scalars(select(SessionRecord.title)))
    assert hashes and all(item.startswith("pbkdf2_sha256$") for item in hashes)
    assert DEMO_PASSWORD not in " ".join(hashes)
    assert "Checkout API" in stored_titles
    rejected = client.post("/v1/auth/login", json={"email": DEMO_EMAIL, "password": "nope"})
    assert rejected.status_code == 401
    assert rejected.json()["code"] == "unauthorized"


def test_seeded_interview_requires_a_bearer_token() -> None:
    anonymous = client.get("/v1/sessions")
    assert anonymous.status_code == 401
    assert client.get("/v1/me").json() is None

    token = login()
    me = client.get("/v1/me", headers=auth(token))
    assert me.json()["displayName"] == "Ada"

    sessions = client.get("/v1/sessions", headers=auth(token)).json()
    titles = [item["title"] for item in sessions]
    assert titles[0] == "Checkout API"
    assert "Practice round" in titles
    checkout = next(item for item in sessions if item["id"] == "checkout-demo")
    assert checkout["state"] == "live"
    assert checkout["hasActiveGuestLink"] is True
    assert "Ada" in checkout["participantNames"]

    detail = client.get("/v1/sessions/checkout-demo", headers=auth(token)).json()
    assert detail["session"]["prompt"].startswith("Sketch the checkout flow")
    assert detail["myRole"] == "owner"
    canvas = client.get("/v1/sessions/checkout-demo/canvas", headers=auth(token)).json()
    labels = [item["label"]["v"] for item in canvas["document"]["elements"].values()]
    assert "API gateway" in labels
    assert "SQL" in labels


def test_interviewer_cannot_end_and_owner_can() -> None:
    owner = login()
    interviewer = login(DEMO_INTERVIEWER_EMAIL)
    denied = client.post("/v1/sessions/checkout-demo/end", headers=auth(interviewer))
    assert denied.status_code == 403
    assert denied.json()["code"] == "forbidden"
    ended = client.post("/v1/sessions/checkout-demo/end", headers=auth(owner))
    assert ended.status_code == 200
    assert ended.json()["state"] == "ended"
    assert client.get("/v1/sessions/checkout-demo/audit", headers=auth(owner)).json()[0]["type"] == "session_ended"


def test_guest_link_hides_the_prompt_until_join() -> None:
    preview = client.get(f"/v1/join/{DEMO_GUEST_TOKEN}")
    assert preview.status_code == 200
    assert preview.json() == {"sessionId": "checkout-demo", "title": "Checkout API", "state": "live"}
    assert "prompt" not in preview.json()

    missing = client.post(
        f"/v1/join/{DEMO_GUEST_TOKEN}",
        json={"displayName": "Casey", "acceptPrivacy": False},
    )
    assert missing.status_code == 400

    joined = client.post(
        f"/v1/join/{DEMO_GUEST_TOKEN}",
        json={"displayName": "Casey", "acceptPrivacy": True},
    )
    assert joined.status_code == 200
    assert "Sketch the checkout flow" in joined.json()["prompt"]
    guest = joined.headers["x-access-token"]
    canvas = client.get("/v1/sessions/checkout-demo/canvas", headers=auth(guest, "guest"))
    assert canvas.status_code == 200
    assert canvas.json()["document"]["elements"]["gateway"]["label"]["v"] == "API gateway"

    owner = login()
    client.put("/v1/sessions/checkout-demo/candidate-editing", headers=auth(owner), json={"enabled": False})
    locked = client.websocket_connect(f"/v1/sessions/checkout-demo/collaboration?access_token={guest}&actor=guest")
    with locked as socket:
        joined_room = socket.receive_json()
        assert joined_room["type"] == "room_joined"
        socket.send_json(
            {
                "type": "document_update",
                "clientOperationId": "guest-edit",
                "op": {
                    "kind": "patch",
                    "epoch": 0,
                    "elements": [
                        {"id": "gateway", "label": {"v": "Blocked", "c": {"t": 9, "a": joined.json()["participant"]["id"]}}}
                    ],
                },
            }
        )
        rejected = socket.receive_json()
        while rejected["type"] == "presence_update":
            rejected = socket.receive_json()
        assert rejected["type"] == "rejected"
        assert rejected["code"] == "locked"


def test_owner_can_edit_the_canvas_over_the_websocket() -> None:
    token = login()
    detail = client.get("/v1/sessions/checkout-demo", headers=auth(token)).json()
    actor = detail["myParticipantId"]
    with client.websocket_connect(f"/v1/sessions/checkout-demo/collaboration?access_token={token}") as socket:
        assert socket.receive_json()["type"] == "room_joined"
        socket.send_json({"type": "ping"})
        seen = set()
        while "pong" not in seen:
            seen.add(socket.receive_json()["type"])
        socket.send_json(
            {
                "type": "document_update",
                "clientOperationId": "rename-gateway",
                "op": {
                    "kind": "patch",
                    "epoch": 0,
                    "elements": [{"id": "gateway", "label": {"v": "Edge", "c": {"t": 20, "a": actor}}}],
                },
            }
        )
        update = socket.receive_json()
        while update["type"] == "presence_update":
            update = socket.receive_json()
        assert update["type"] == "document_update"
        assert update["op"]["elements"][0]["label"]["v"] == "Edge"
    canvas = client.get("/v1/sessions/checkout-demo/canvas", headers=auth(token)).json()
    assert canvas["document"]["elements"]["gateway"]["label"]["v"] == "Edge"


def test_magic_link_is_single_use_and_sign_out_revokes_the_bearer_token() -> None:
    issued = client.post("/v1/auth/magic-links", json={"email": "cara@lattice.test"})
    assert issued.status_code == 200
    path = issued.json()["verificationPath"]
    token = path.split("token=", 1)[1]
    assert token not in json.dumps(store.magic_links)
    completed = client.post("/v1/auth/magic-links/complete", json={"token": token})
    assert completed.status_code == 200
    assert completed.json()["email"] == "cara@lattice.test"
    access = completed.headers["x-access-token"]
    assert client.get("/v1/me", headers=auth(access)).json()["email"] == "cara@lattice.test"
    again = client.post("/v1/auth/magic-links/complete", json={"token": token})
    assert again.status_code == 400
    assert again.json()["code"] == "invalid"
    assert client.post("/v1/auth/sign-out", headers=auth(access)).status_code == 204
    assert client.get("/v1/sessions", headers=auth(access)).status_code == 401


def test_a_new_store_reads_rows_from_the_database() -> None:
    token = login()
    created = client.post("/v1/sessions", headers=auth(token), json={"title": "Persisted feed"})
    assert created.status_code == 201
    from app.store import Store

    revived = Store()
    titles = [item["title"] for item in revived.sessions]
    assert "Persisted feed" in titles
    assert "Checkout API" in titles


def test_create_session_and_unknown_guest_link() -> None:
    token = login()
    created = client.post(
        "/v1/sessions",
        headers=auth(token),
        json={"title": "News feed", "prompt": "Design ingestion.", "durationMinutes": 60},
    )
    assert created.status_code == 201
    assert created.json()["state"] == "draft"
    assert created.json()["durationMinutes"] == 60
    missing = client.get("/v1/join/" + ("ab" * 32))
    assert missing.status_code == 404
    assert missing.json()["code"] == "not_found"
