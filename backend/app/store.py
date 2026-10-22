import json
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from threading import RLock
from typing import Any

from app.auth import hash_password, new_token, normalize_email, sha256_hex, verify_password
from app.database import init_database
from app.persistence import load_state, save_state
from app.models import (
    COMPONENT_TYPES,
    DESCRIPTION_MAX,
    ELEMENT_LIMIT,
    LABEL_MAX,
    OP_BYTES_MAX,
    STROKE_POINT_LIMIT,
    STROKE_POINTS_MAX,
    ApiError,
)

DEMO_EMAIL = "ada@lattice.test"
DEMO_PASSWORD = "lattice-demo"
DEMO_INTERVIEWER_EMAIL = "bea@lattice.test"
DEMO_GUEST_TOKEN = "c0ffee01" * 8
COLORS = ["#2f6fed", "#c43d3d", "#0f8a6a", "#b86a10", "#7a45d1", "#0e7490", "#c44e86", "#4d6b1f"]
MAGIC_TTL = timedelta(minutes=15)
GUEST_TTL = timedelta(hours=2)
ELEMENT_FIELDS = ("tomb", "type", "x", "y", "width", "height", "label", "description", "fill", "z", "parentId")
CONNECTOR_FIELDS = (
    "tomb",
    "fromId",
    "toId",
    "fromAnchor",
    "toAnchor",
    "route",
    "arrowStart",
    "arrowEnd",
    "dashed",
    "color",
    "width",
    "label",
)
STROKE_FIELDS = ("tomb", "tool", "color", "width", "opacity", "points")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def stable_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def empty_doc(epoch: int = 0) -> dict[str, Any]:
    return {"schemaVersion": 1, "epoch": epoch, "elements": {}, "connectors": {}, "strokes": {}}


def reg(value: Any, when: int, actor: str) -> dict[str, Any]:
    return {"v": value, "c": {"t": when, "a": actor}}


class Store:
    def __init__(self) -> None:
        self._lock = RLock()
        self._depth = 0
        self._empty()
        init_database()
        with self._transaction():
            if not self.users:
                self._seed()

    def reset(self) -> None:
        with self._transaction():
            self._empty()
            self._seed()

    def _empty(self) -> None:
        self.users: list[dict[str, Any]] = []
        self.magic_links: list[dict[str, Any]] = []
        self.sessions: list[dict[str, Any]] = []
        self.memberships: list[dict[str, Any]] = []
        self.invites: list[dict[str, Any]] = []
        self.guest_links: list[dict[str, Any]] = []
        self.participants: list[dict[str, Any]] = []
        self.documents: list[dict[str, Any]] = []
        self.operations: list[dict[str, Any]] = []
        self.snapshots: list[dict[str, Any]] = []
        self.blobs: dict[str, dict[str, Any]] = {}
        self.audit: list[dict[str, Any]] = []
        self.credentials: list[dict[str, Any]] = []
        self.tokens: dict[str, dict[str, Any]] = {}
        self.rate_events: list[dict[str, Any]] = []

    def _load(self) -> None:
        state = load_state()
        self.users = state["users"]
        self.magic_links = state["magic_links"]
        self.sessions = state["sessions"]
        self.memberships = state["memberships"]
        self.invites = state["invites"]
        self.guest_links = state["guest_links"]
        self.participants = state["participants"]
        self.documents = state["documents"]
        self.operations = state["operations"]
        self.snapshots = state["snapshots"]
        self.blobs = state["blobs"]
        self.audit = state["audit"]
        self.credentials = state["credentials"]
        self.tokens = state["tokens"]
        self.rate_events = state["rate_events"]

    def _flush(self) -> None:
        save_state(
            {
                "users": self.users,
                "magic_links": self.magic_links,
                "sessions": self.sessions,
                "memberships": self.memberships,
                "invites": self.invites,
                "guest_links": self.guest_links,
                "participants": self.participants,
                "documents": self.documents,
                "operations": self.operations,
                "snapshots": self.snapshots,
                "blobs": self.blobs,
                "audit": self.audit,
                "credentials": self.credentials,
                "tokens": self.tokens,
                "rate_events": self.rate_events,
            }
        )

    @contextmanager
    def _transaction(self):
        self._lock.acquire()
        outermost = self._depth == 0
        self._depth += 1
        loaded = False
        try:
            if outermost:
                self._load()
                loaded = True
            yield
            if outermost:
                self._flush()
        except Exception as error:
            if outermost and loaded and isinstance(error, ApiError):
                self._flush()
            elif outermost and loaded:
                self._load()
            raise
        finally:
            self._depth -= 1
            self._lock.release()

    def public_user(self, user: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": user["id"],
            "email": user["email"],
            "displayName": user["displayName"],
            "organizationId": user["organizationId"],
            "createdAt": user["createdAt"],
        }

    def user_for_token(self, raw: str) -> dict[str, Any] | None:
        with self._transaction():
            record = self._token(raw)
            if record is None or record["kind"] != "user" or self._expired(record):
                return None
            user = self._user(record["userId"])
            return None if user is None else self.public_user(user)

    def login(self, email: str, password: str) -> tuple[dict[str, Any], str]:
        with self._transaction():
            normalized = normalize_email(email)
            user = next((item for item in self.users if item["email"] == normalized), None)
            if user is None or not verify_password(password, user["passwordHash"]):
                raise ApiError("unauthorized", "Email or password is incorrect.", 401)
            self._claim_invites(user)
            return self.public_user(user), self._issue_user_token(user["id"])

    def request_magic_link(self, email: str) -> dict[str, str]:
        with self._transaction():
            normalized = normalize_email(email)
            self._consume_rate(f"magic:{normalized}", 5, timedelta(minutes=10))
            token = new_token()
            self.magic_links.append(
                {
                    "id": new_token(),
                    "tokenHash": sha256_hex(token),
                    "email": normalized,
                    "expiresAt": self._iso_after(MAGIC_TTL),
                    "usedAt": None,
                }
            )
            return {"verificationPath": f"/auth/verify?token={token}"}

    def complete_magic_link(self, token: str) -> tuple[dict[str, Any], str]:
        with self._transaction():
            digest = sha256_hex(token)
            link = next((item for item in self.magic_links if item["tokenHash"] == digest), None)
            if link is None:
                raise ApiError("not_found", "This sign-in link is not valid.", 404)
            if link["usedAt"]:
                raise ApiError("invalid", "This sign-in link was already used.")
            if parse_time(link["expiresAt"]) <= datetime.now(timezone.utc):
                raise ApiError("expired", "This sign-in link has expired.")
            link["usedAt"] = now_iso()
            user = next((item for item in self.users if item["email"] == link["email"]), None)
            if user is None:
                user = self._add_user(link["email"], hash_password(new_token()))
            self._claim_invites(user)
            return self.public_user(user), self._issue_user_token(user["id"])

    def revoke_token(self, raw: str) -> None:
        with self._transaction():
            record = self._token(raw)
            if record is None or record["kind"] != "user":
                raise ApiError("unauthorized", "Sign in to continue.", 401)
            self.tokens.pop(sha256_hex(raw), None)

    def list_sessions(self, user_id: str) -> list[dict[str, Any]]:
        with self._transaction():
            rows = []
            for session in self.sessions:
                membership = self._membership(session["id"], user_id)
                if membership is None:
                    continue
                rows.append(self._list_item(session, membership["role"]))
            rows.sort(key=lambda item: item["updatedAt"], reverse=True)
            return rows

    def create_session(self, user: dict[str, Any], body: dict[str, Any]) -> dict[str, Any]:
        with self._transaction():
            self._consume_rate(f"create:{user['id']}", 30, timedelta(hours=1))
            title = self._clean(body.get("title", ""), 200)
            if not title:
                raise ApiError("invalid", "Enter a title.")
            document = body.get("initialDocument") or empty_doc()
            self._assert_document(document)
            limit = self._within_limits(document)
            if limit:
                raise ApiError("too_large", limit)
            created = now_iso()
            session = {
                "id": new_token()[:16],
                "ownerUserId": user["id"],
                "title": title,
                "prompt": self._clean(body.get("prompt") or "", 10_000),
                "state": "draft",
                "candidateEditingEnabled": True,
                "cursorVisibility": True,
                "durationMinutes": self._duration(body.get("durationMinutes")),
                "scheduledAt": self._schedule(body.get("scheduledAt")),
                "startedAt": None,
                "endedAt": None,
                "createdAt": created,
                "updatedAt": created,
                "maxParticipants": 10,
            }
            self.sessions.append(session)
            self.memberships.append(self._membership_row(session["id"], user["id"], "owner", created))
            self.documents.append(self._document_row(session["id"], document, created))
            self._add_participant(session["id"], user["displayName"], "owner", user["id"], None)
            self._audit(session["id"], user["id"], "session_created", "Session created")
            return deepcopy(session)

    def get_session(self, actor_token: str, session_id: str, mode: str) -> dict[str, Any]:
        with self._transaction():
            actor = self._resolve_actor(actor_token, session_id, mode)
            if actor.user_id:
                self._ensure_participant(session_id, actor)
            session = self._require_session(session_id)
            self._assert_can_view(actor.role, session)
            return self._detail(session, actor.role, actor.participant_id)

    def update_session(self, user: dict[str, Any], session_id: str, patch: dict[str, Any]) -> tuple[dict[str, Any], list]:
        with self._transaction():
            actor = self._owner_user(user["id"], session_id, "update the interview")
            session = self._require_session(session_id)
            if session["state"] in {"ended", "archived"}:
                raise ApiError("ended", "Ended interviews are read-only.", 403)
            if "title" in patch and patch["title"] is not None:
                title = self._clean(patch["title"], 200)
                if not title:
                    raise ApiError("invalid", "Enter a title.")
                session["title"] = title
            if "prompt" in patch and patch["prompt"] is not None:
                session["prompt"] = self._clean(patch["prompt"], 10_000)
            if "scheduledAt" in patch:
                session["scheduledAt"] = self._schedule(patch["scheduledAt"])
            if "durationMinutes" in patch:
                session["durationMinutes"] = self._duration(patch["durationMinutes"])
            if patch.get("maxParticipants") is not None:
                capacity = patch["maxParticipants"]
                if capacity < 2 or capacity > 10:
                    raise ApiError("invalid", "Participant capacity must be between 2 and 10.")
                session["maxParticipants"] = capacity
            session["updatedAt"] = now_iso()
            return deepcopy(session), [self._replaced(session_id)]

    def start_session(self, user: dict[str, Any], session_id: str) -> tuple[dict[str, Any], list]:
        with self._transaction():
            self._owner_user(user["id"], session_id, "start the interview")
            session = self._require_session(session_id)
            if session["state"] == "live":
                return deepcopy(session), []
            if session["state"] != "draft":
                raise ApiError("invalid", "Only a draft interview can be started.")
            session["state"] = "live"
            session["startedAt"] = now_iso()
            session["updatedAt"] = session["startedAt"]
            self._audit(session_id, user["id"], "session_started", "Session started")
            return deepcopy(session), [self._replaced(session_id)]

    def end_session(self, user: dict[str, Any], session_id: str) -> tuple[dict[str, Any], list]:
        with self._transaction():
            self._owner_user(user["id"], session_id, "end the session")
            session = self._require_session(session_id)
            if session["state"] in {"ended", "archived"}:
                raise ApiError("invalid", "This interview has already ended.")
            self._write_snapshot(session_id)
            session["state"] = "ended"
            session["endedAt"] = now_iso()
            session["updatedAt"] = session["endedAt"]
            session["candidateEditingEnabled"] = False
            self._audit(session_id, user["id"], "session_ended", "Session ended")
            return deepcopy(session), [(session_id, {"type": "session_ended", "session": deepcopy(session)})]

    def archive_session(self, user: dict[str, Any], session_id: str) -> tuple[dict[str, Any], list]:
        with self._transaction():
            self._owner_user(user["id"], session_id, "archive the session")
            session = self._require_session(session_id)
            if session["state"] == "archived":
                return deepcopy(session), []
            if session["state"] in {"draft", "live"}:
                self._write_snapshot(session_id)
            if session["endedAt"] is None and session["state"] != "draft":
                session["endedAt"] = now_iso()
            session["state"] = "archived"
            session["updatedAt"] = now_iso()
            session["candidateEditingEnabled"] = False
            self._audit(session_id, user["id"], "session_archived", "Session archived")
            return deepcopy(session), [(session_id, {"type": "session_ended", "session": deepcopy(session)})]

    def duplicate_session(self, user: dict[str, Any], session_id: str) -> dict[str, Any]:
        with self._transaction():
            self._owner_user(user["id"], session_id, "duplicate the interview")
            source = self._require_session(session_id)
            source_doc = self._document(session_id)
            created = now_iso()
            session = {
                **deepcopy(source),
                "id": new_token()[:16],
                "state": "draft",
                "candidateEditingEnabled": True,
                "startedAt": None,
                "endedAt": None,
                "createdAt": created,
                "updatedAt": created,
            }
            self.sessions.append(session)
            self.memberships.append(self._membership_row(session["id"], user["id"], "owner", created))
            self.documents.append(self._document_row(session["id"], deepcopy(source_doc["state"]), created))
            self._add_participant(session["id"], user["displayName"], "owner", user["id"], None)
            self._audit(session["id"], user["id"], "session_duplicated", "Session duplicated")
            return deepcopy(session)

    def create_guest_link(self, user: dict[str, Any], session_id: str, body: dict[str, Any]) -> dict[str, Any]:
        with self._transaction():
            self._owner_user(user["id"], session_id, "create a guest link")
            session = self._require_session(session_id)
            if session["state"] in {"ended", "archived"}:
                raise ApiError("archived", "This interview is no longer accepting guests.", 403)
            role = body.get("roleGranted") or "candidate"
            max_uses = body.get("maxUses")
            if max_uses is not None and max_uses < 1:
                raise ApiError("invalid", "Maximum uses must be at least 1.")
            expires = body.get("expiresAt")
            if expires:
                try:
                    parse_time(expires)
                except ValueError:
                    raise ApiError("invalid", "Expiration is not a valid time.") from None
            created = now_iso()
            for link in self.guest_links:
                if link["sessionId"] == session_id and link["roleGranted"] == role and link["revokedAt"] is None:
                    link["revokedAt"] = created
            token = new_token()
            link = {
                "id": new_token()[:16],
                "sessionId": session_id,
                "tokenHash": sha256_hex(token),
                "roleGranted": role,
                "expiresAt": expires,
                "maxUses": max_uses,
                "useCount": 0,
                "revokedAt": None,
                "createdAt": created,
            }
            self.guest_links.append(link)
            self._audit(session_id, user["id"], "link_created", "Guest link created")
            return {
                "id": link["id"],
                "sessionId": session_id,
                "roleGranted": role,
                "expiresAt": expires,
                "maxUses": max_uses,
                "createdAt": created,
                "token": token,
                "path": f"/join/{token}",
            }

    def revoke_guest_link(self, user: dict[str, Any], session_id: str, link_id: str) -> None:
        with self._transaction():
            self._owner_user(user["id"], session_id, "revoke a guest link")
            link = next((item for item in self.guest_links if item["id"] == link_id and item["sessionId"] == session_id), None)
            if link is None:
                raise ApiError("not_found", "That guest link could not be found.", 404)
            if link["revokedAt"] is None:
                link["revokedAt"] = now_iso()
            self._audit(session_id, user["id"], "link_revoked", "Guest link revoked")

    def invite(self, user: dict[str, Any], session_id: str, email: str, role: str) -> None:
        with self._transaction():
            self._owner_user(user["id"], session_id, "invite someone")
            self._require_session(session_id)
            normalized = normalize_email(email)
            owner = self._user(user["id"])
            if owner and owner["email"] == normalized:
                raise ApiError("invalid", "You already own this interview.")
            existing = next((item for item in self.users if item["email"] == normalized), None)
            if existing is not None:
                membership = self._membership(session_id, existing["id"])
                if membership and membership["role"] == "owner":
                    raise ApiError("invalid", "You already own this interview.")
                if membership is None:
                    self.memberships.append(self._membership_row(session_id, existing["id"], role, now_iso()))
                elif membership["role"] != "owner":
                    membership["role"] = role
                    membership["updatedAt"] = now_iso()
            else:
                self.invites = [item for item in self.invites if not (item["sessionId"] == session_id and item["email"] == normalized)]
                self.invites.append(
                    {"id": new_token()[:16], "sessionId": session_id, "email": normalized, "role": role, "createdAt": now_iso()}
                )
            self._audit(session_id, user["id"], "invite_sent", f"Invited an {role}")

    def remove_participant(self, user: dict[str, Any], session_id: str, participant_id: str) -> list:
        with self._transaction():
            self._owner_user(user["id"], session_id, "remove a participant")
            participant = next(
                (item for item in self.participants if item["id"] == participant_id and item["sessionId"] == session_id),
                None,
            )
            if participant is None:
                raise ApiError("not_found", "That participant could not be found.", 404)
            if participant["role"] == "owner":
                raise ApiError("invalid", "The owner cannot be removed.")
            participant["leftAt"] = now_iso()
            participant["updatedAt"] = participant["leftAt"]
            for credential in self.credentials:
                if credential["participantId"] == participant_id:
                    credential["revokedAt"] = participant["leftAt"]
            self.tokens = {
                digest: record
                for digest, record in self.tokens.items()
                if record.get("participantId") != participant_id
            }
            self._audit(session_id, user["id"], "participant_removed", "Participant removed")
            return [(session_id, {"type": "participant_removed", "participantId": participant_id})]

    def set_candidate_editing(self, user: dict[str, Any], session_id: str, enabled: bool) -> tuple[dict[str, Any], list]:
        with self._transaction():
            self._owner_user(user["id"], session_id, "lock candidate editing")
            session = self._require_session(session_id)
            if session["state"] in {"ended", "archived"}:
                raise ApiError("ended", "Ended interviews are read-only.", 403)
            session["candidateEditingEnabled"] = enabled
            session["updatedAt"] = now_iso()
            detail = "Candidate editing unlocked" if enabled else "Candidate editing locked"
            self._audit(session_id, user["id"], "permission_changed", detail)
            event = {
                "type": "permission_changed",
                "candidateEditingEnabled": session["candidateEditingEnabled"],
                "cursorVisibility": session["cursorVisibility"],
            }
            return deepcopy(session), [(session_id, event)]

    def set_cursor_visibility(self, user: dict[str, Any], session_id: str, visible: bool) -> tuple[dict[str, Any], list]:
        with self._transaction():
            self._owner_user(user["id"], session_id, "change cursor visibility")
            session = self._require_session(session_id)
            session["cursorVisibility"] = visible
            session["updatedAt"] = now_iso()
            event = {
                "type": "permission_changed",
                "candidateEditingEnabled": session["candidateEditingEnabled"],
                "cursorVisibility": session["cursorVisibility"],
            }
            return deepcopy(session), [(session_id, event)]

    def list_audit(self, actor_token: str, session_id: str, mode: str) -> list[dict[str, Any]]:
        with self._transaction():
            actor = self._resolve_actor(actor_token, session_id, mode)
            if actor.role not in {"owner", "interviewer"}:
                raise ApiError("forbidden", "You cannot view the activity log.", 403)
            rows = [deepcopy(item) for item in self.audit if item["sessionId"] == session_id]
            rows.sort(key=lambda item: item["at"], reverse=True)
            return rows

    def get_canvas(self, actor_token: str, session_id: str, mode: str) -> dict[str, Any]:
        with self._transaction():
            actor = self._resolve_actor(actor_token, session_id, mode)
            session = self._require_session(session_id)
            self._assert_can_view(actor.role, session)
            document = self._document(session_id)
            return {
                "schemaVersion": document["schemaVersion"],
                "cursor": document["cursor"],
                "epoch": document["epoch"],
                "document": deepcopy(document["state"]),
            }

    def clear_canvas(self, user: dict[str, Any], session_id: str) -> tuple[dict[str, str], list]:
        with self._transaction():
            actor = self._owner_user(user["id"], session_id, "clear the canvas")
            session = self._require_session(session_id)
            if session["state"] in {"ended", "archived"}:
                raise ApiError("ended", "Ended interviews are read-only.", 403)
            snapshot_id = self._write_snapshot(session_id)
            document = self._document(session_id)
            next_epoch = document["epoch"] + 1
            cleared = empty_doc(next_epoch)
            document["state"] = cleared
            document["epoch"] = next_epoch
            document["cursor"] += 1
            document["updatedAt"] = now_iso()
            session["updatedAt"] = document["updatedAt"]
            client_operation_id = new_token()
            self._record_op(document, actor.participant_id, client_operation_id, {"kind": "restore", "epoch": next_epoch, "state": cleared})
            self._audit(session_id, user["id"], "canvas_cleared", "Canvas cleared")
            event = {
                "type": "document_update",
                "cursor": document["cursor"],
                "actorId": actor.participant_id,
                "clientOperationId": client_operation_id,
                "op": {"kind": "restore", "epoch": next_epoch, "state": deepcopy(cleared)},
            }
            return {"snapshotId": snapshot_id}, [(session_id, event)]

    def restore_snapshot(self, user: dict[str, Any], session_id: str, snapshot_id: str) -> list:
        with self._transaction():
            actor = self._owner_user(user["id"], session_id, "restore a snapshot")
            session = self._require_session(session_id)
            if session["state"] in {"ended", "archived"}:
                raise ApiError("ended", "Ended interviews are read-only.", 403)
            snapshot = next((item for item in self.snapshots if item["id"] == snapshot_id), None)
            blob = self.blobs.get(snapshot["storageKey"]) if snapshot else None
            if snapshot is None or blob is None:
                raise ApiError("not_found", "That snapshot could not be found.", 404)
            document = self._document(session_id)
            next_epoch = document["epoch"] + 1
            restored = deepcopy(blob)
            restored["epoch"] = next_epoch
            restored["schemaVersion"] = 1
            document["state"] = restored
            document["epoch"] = next_epoch
            document["cursor"] += 1
            document["updatedAt"] = now_iso()
            session["updatedAt"] = document["updatedAt"]
            client_operation_id = new_token()
            self._record_op(document, actor.participant_id, client_operation_id, {"kind": "restore", "epoch": next_epoch, "state": restored})
            self._audit(session_id, user["id"], "snapshot_restored", "Canvas snapshot restored")
            event = {
                "type": "document_update",
                "cursor": document["cursor"],
                "actorId": actor.participant_id,
                "clientOperationId": client_operation_id,
                "op": {"kind": "restore", "epoch": next_epoch, "state": deepcopy(restored)},
            }
            return [(session_id, event)]

    def export_canvas(self, actor_token: str, session_id: str, mode: str) -> dict[str, Any]:
        with self._transaction():
            actor = self._resolve_actor(actor_token, session_id, mode)
            session = self._require_session(session_id)
            if not self._can(actor.role, "export", session):
                raise ApiError("forbidden", "You cannot export this interview.", 403)
            document = self._document(session_id)
            return {
                "schemaVersion": 1,
                "sessionId": session["id"],
                "title": session["title"],
                "exportedAt": now_iso(),
                "document": deepcopy(document["state"]),
            }

    def preview_join(self, token: str) -> dict[str, Any]:
        with self._transaction():
            session, _link = self._lookup_join(token)
            return {"sessionId": session["id"], "title": session["title"], "state": session["state"]}

    def join(self, token: str, display_name: str, accept_privacy: bool) -> tuple[dict[str, Any], str]:
        with self._transaction():
            if not accept_privacy:
                raise ApiError("invalid", "Accept the privacy notice to join.")
            name = self._clean(display_name.strip(), 40)
            if not name:
                raise ApiError("invalid", "Enter a display name.")
            session, link = self._lookup_join(token)
            link["useCount"] += 1
            participant = self._add_participant(session["id"], name, link["roleGranted"], None, link["id"])
            raw, _record = self._issue_guest_token(session["id"], participant["id"])
            return self._join_result(session, participant), raw

    def restore_guest(self, raw: str | None, session_id: str) -> dict[str, Any] | None:
        with self._transaction():
            if not raw:
                return None
            record = self._token(raw)
            if record is None or record["kind"] != "guest" or record["sessionId"] != session_id:
                return None
            if self._expired(record) or record.get("revokedAt"):
                raise ApiError("unauthorized", "Your session expired. Join the interview again.", 401)
            participant = next((item for item in self.participants if item["id"] == record["participantId"]), None)
            if participant is None or participant["leftAt"]:
                raise ApiError("removed", "You were removed from this interview.", 403)
            session = self._require_session(session_id)
            if participant["role"] == "candidate" and session["state"] in {"ended", "archived"}:
                raise ApiError("ended", "This interview has ended.", 403)
            return self._join_result(session, participant)

    def connect_room(self, raw: str, session_id: str, mode: str) -> dict[str, Any]:
        with self._transaction():
            actor = self._resolve_actor(raw, session_id, mode)
            if actor.user_id:
                self._ensure_participant(session_id, actor)
            session = self._require_session(session_id)
            self._assert_can_view(actor.role, session)
            participant = next(item for item in self.participants if item["id"] == actor.participant_id)
            document = self._document(session_id)
            return {
                "participant": deepcopy(participant),
                "session": deepcopy(session),
                "document": deepcopy(document["state"]),
                "cursor": document["cursor"],
                "epoch": document["epoch"],
            }

    def apply_op(self, raw: str, session_id: str, mode: str, client_operation_id: str, op: dict[str, Any]) -> tuple[int, dict[str, Any] | None]:
        with self._transaction():
            actor = self._resolve_actor(raw, session_id, mode)
            self._consume_rate(f"ops:{actor.participant_id}", 600, timedelta(minutes=1))
            encoded = json.dumps(op)
            if len(encoded) > OP_BYTES_MAX:
                raise ApiError("too_large", "That edit is too large.")
            problem = validate_op(op)
            if problem:
                raise ApiError("invalid", problem)
            participant = next((item for item in self.participants if item["id"] == actor.participant_id), None)
            if participant is None or participant["leftAt"]:
                raise ApiError("removed", "You were removed from this interview.", 403)
            session = self._require_session(session_id)
            self._assert_can_edit(actor.role, session)
            document = self._document(session_id)
            duplicate = next(
                (
                    item
                    for item in self.operations
                    if item["clientOperationId"] == client_operation_id and item["canvasDocumentId"] == document["id"]
                ),
                None,
            )
            if duplicate is not None:
                return duplicate["cursor"], None
            applied, changed = apply_canvas_op(document["state"], op)
            if not changed:
                raise ApiError(
                    "conflict",
                    "The canvas changed and this edit could not be merged safely. The saved canvas was kept.",
                    409,
                )
            limit = self._within_limits(applied)
            if limit:
                raise ApiError("too_large", limit)
            document["state"] = applied
            document["epoch"] = applied["epoch"]
            document["cursor"] += 1
            document["updatedAt"] = now_iso()
            session["updatedAt"] = document["updatedAt"]
            stored_op = op if op.get("kind") == "patch" else {"kind": "restore", "epoch": document["epoch"], "state": deepcopy(applied)}
            self._record_op(document, actor.participant_id, client_operation_id, stored_op)
            event = {
                "type": "document_update",
                "cursor": document["cursor"],
                "actorId": actor.participant_id,
                "clientOperationId": client_operation_id,
                "op": stored_op,
            }
            return document["cursor"], event

    def room_document(self, session_id: str) -> dict[str, Any]:
        with self._transaction():
            document = self._document(session_id)
            return deepcopy(document["state"])

    def resolve_actor(self, raw: str, session_id: str, mode: str):
        with self._transaction():
            return self._resolve_actor(raw, session_id, mode)

    def _resolve_actor(self, raw: str, session_id: str, mode: str):
        from app.auth import Actor

        record = self._token(raw)
        if record is None or self._expired(record):
            raise ApiError("unauthorized", "Sign in to continue.", 401)
        if mode == "guest":
            if record["kind"] != "guest" or record["sessionId"] != session_id:
                raise ApiError("forbidden", "You do not have access to this interview.", 403)
            participant = next((item for item in self.participants if item["id"] == record["participantId"]), None)
            if participant is None or participant["leftAt"]:
                raise ApiError("removed", "You were removed from this interview.", 403)
            return Actor("guest", participant["role"], None, participant["id"], session_id)
        if record["kind"] != "user":
            raise ApiError("forbidden", "You do not have access to this interview.", 403)
        membership = self._membership(session_id, record["userId"])
        if membership is None:
            raise ApiError("forbidden", "You do not have access to this interview.", 403)
        participant = next(
            (item for item in self.participants if item["sessionId"] == session_id and item["userId"] == record["userId"]),
            None,
        )
        if participant and participant["leftAt"]:
            raise ApiError("removed", "You were removed from this interview.", 403)
        return Actor("user", membership["role"], record["userId"], participant["id"] if participant else "", session_id)

    def _seed(self) -> None:
        created = "2026-08-03T15:00:00.000Z"
        ada = self._add_user(DEMO_EMAIL, hash_password(DEMO_PASSWORD), "Ada", created)
        bea = self._add_user(DEMO_INTERVIEWER_EMAIL, hash_password(DEMO_PASSWORD), "Bea", created)
        document = self._seed_document(ada["id"])
        session = {
            "id": "checkout-demo",
            "ownerUserId": ada["id"],
            "title": "Checkout API",
            "prompt": "Sketch the checkout flow. Candidates see this after they join.",
            "state": "live",
            "candidateEditingEnabled": True,
            "cursorVisibility": True,
            "durationMinutes": 45,
            "scheduledAt": None,
            "startedAt": created,
            "endedAt": None,
            "createdAt": created,
            "updatedAt": created,
            "maxParticipants": 10,
        }
        practice = {
            "id": "practice-demo",
            "ownerUserId": ada["id"],
            "title": "Practice round",
            "prompt": "",
            "state": "draft",
            "candidateEditingEnabled": True,
            "cursorVisibility": True,
            "durationMinutes": None,
            "scheduledAt": None,
            "startedAt": None,
            "endedAt": None,
            "createdAt": created,
            "updatedAt": "2026-08-02T15:00:00.000Z",
            "maxParticipants": 10,
        }
        self.sessions.extend([session, practice])
        self.memberships.append(self._membership_row(session["id"], ada["id"], "owner", created))
        self.memberships.append(self._membership_row(session["id"], bea["id"], "interviewer", created))
        self.memberships.append(self._membership_row(practice["id"], ada["id"], "owner", created))
        self.documents.append(self._document_row(session["id"], document, created))
        self.documents.append(self._document_row(practice["id"], empty_doc(), created))
        self._add_participant(session["id"], ada["displayName"], "owner", ada["id"], None)
        self._add_participant(practice["id"], ada["displayName"], "owner", ada["id"], None)
        self.guest_links.append(
            {
                "id": "checkout-link",
                "sessionId": session["id"],
                "tokenHash": sha256_hex(DEMO_GUEST_TOKEN),
                "roleGranted": "candidate",
                "expiresAt": None,
                "maxUses": None,
                "useCount": 0,
                "revokedAt": None,
                "createdAt": created,
            }
        )
        self._audit(session["id"], ada["id"], "session_created", "Session created")
        self._audit(practice["id"], ada["id"], "session_created", "Session created")

    def _seed_document(self, actor: str) -> dict[str, Any]:
        def element(item_id: str, kind: str, x: int, y: int, label: str) -> dict[str, Any]:
            return {
                "id": item_id,
                "createdBy": actor,
                "type": reg(kind, 1, actor),
                "x": reg(x, 1, actor),
                "y": reg(y, 1, actor),
                "width": reg(160, 1, actor),
                "height": reg(72, 1, actor),
                "label": reg(label, 1, actor),
                "description": reg("", 1, actor),
                "fill": reg(None, 1, actor),
                "z": reg(1, 1, actor),
                "parentId": reg(None, 1, actor),
            }

        def connector(item_id: str, source: str, target: str, label: str) -> dict[str, Any]:
            return {
                "id": item_id,
                "createdBy": actor,
                "fromId": reg(source, 1, actor),
                "toId": reg(target, 1, actor),
                "fromAnchor": reg("auto", 1, actor),
                "toAnchor": reg("auto", 1, actor),
                "route": reg("elbow", 1, actor),
                "arrowStart": reg(False, 1, actor),
                "arrowEnd": reg(True, 1, actor),
                "dashed": reg(False, 1, actor),
                "color": reg("#8fd0c6", 1, actor),
                "width": reg(2, 1, actor),
                "label": reg(label, 1, actor),
            }

        elements = [
            element("browser", "browser", 80, 180, "Browser"),
            element("gateway", "gateway", 320, 180, "API gateway"),
            element("service", "service", 580, 180, "App service"),
            element("sql", "sql", 860, 80, "SQL"),
        ]
        connectors = [connector("c1", "browser", "gateway", "HTTPS"), connector("c2", "gateway", "service", "HTTP")]
        return {
            "schemaVersion": 1,
            "epoch": 0,
            "elements": {item["id"]: item for item in elements},
            "connectors": {item["id"]: item for item in connectors},
            "strokes": {},
        }

    def _add_user(self, email: str, password_hash: str, display_name: str | None = None, created: str | None = None) -> dict[str, Any]:
        local = email.split("@", 1)[0].replace(".", " ").replace("_", " ").replace("-", " ")
        name = display_name or " ".join(part.capitalize() for part in local.split()) or "Interviewer"
        user = {
            "id": new_token()[:16],
            "email": email,
            "displayName": name,
            "organizationId": None,
            "createdAt": created or now_iso(),
            "passwordHash": password_hash,
        }
        self.users.append(user)
        return user

    def _issue_user_token(self, user_id: str) -> str:
        raw = new_token()
        self.tokens[sha256_hex(raw)] = {"kind": "user", "userId": user_id, "expiresAt": None, "revokedAt": None}
        return raw

    def _issue_guest_token(self, session_id: str, participant_id: str) -> tuple[str, dict[str, Any]]:
        raw = new_token()
        expires = self._iso_after(GUEST_TTL)
        record = {
            "kind": "guest",
            "sessionId": session_id,
            "participantId": participant_id,
            "userId": None,
            "expiresAt": expires,
            "revokedAt": None,
        }
        self.tokens[sha256_hex(raw)] = record
        self.credentials.append(
            {
                "tokenHash": sha256_hex(raw),
                "participantId": participant_id,
                "sessionId": session_id,
                "expiresAt": expires,
                "revokedAt": None,
            }
        )
        return raw, record

    def _token(self, raw: str) -> dict[str, Any] | None:
        return self.tokens.get(sha256_hex(raw))

    def _expired(self, record: dict[str, Any]) -> bool:
        if record.get("revokedAt"):
            return True
        expires = record.get("expiresAt")
        return bool(expires and parse_time(expires) <= datetime.now(timezone.utc))

    def _user(self, user_id: str) -> dict[str, Any] | None:
        return next((item for item in self.users if item["id"] == user_id), None)

    def _claim_invites(self, user: dict[str, Any]) -> None:
        pending = [item for item in self.invites if item["email"] == user["email"]]
        for invite in pending:
            membership = self._membership(invite["sessionId"], user["id"])
            if membership is None:
                self.memberships.append(self._membership_row(invite["sessionId"], user["id"], invite["role"], now_iso()))
            elif membership["role"] != "owner":
                membership["role"] = invite["role"]
                membership["updatedAt"] = now_iso()
        self.invites = [item for item in self.invites if item["email"] != user["email"]]

    def _owner_user(self, user_id: str, session_id: str, action: str):
        from app.auth import Actor

        membership = self._membership(session_id, user_id)
        if membership is None:
            raise ApiError("forbidden", "You do not have access to this interview.", 403)
        if membership["role"] != "owner":
            raise ApiError("forbidden", f"Only the interview owner can {action}.", 403)
        participant = next(
            (item for item in self.participants if item["sessionId"] == session_id and item["userId"] == user_id and not item["leftAt"]),
            None,
        )
        if participant is None:
            user = self._user(user_id)
            participant = self._add_participant(session_id, user["displayName"] if user else "Owner", "owner", user_id, None)
        return Actor("user", "owner", user_id, participant["id"], session_id)

    def _ensure_participant(self, session_id: str, actor) -> None:
        if any(item["id"] == actor.participant_id and not item["leftAt"] for item in self.participants):
            return
        user = self._user(actor.user_id) if actor.user_id else None
        if user is None:
            raise ApiError("unauthorized", "Sign in to continue.", 401)
        existing = next(
            (item for item in self.participants if item["sessionId"] == session_id and item["userId"] == user["id"] and not item["leftAt"]),
            None,
        )
        created = existing or self._add_participant(session_id, user["displayName"], actor.role, user["id"], None)
        actor.participant_id = created["id"]

    def _add_participant(self, session_id: str, display_name: str, role: str, user_id: str | None, link_id: str | None) -> dict[str, Any]:
        created = now_iso()
        participant = {
            "id": new_token()[:16],
            "sessionId": session_id,
            "userId": user_id,
            "guestLinkId": link_id,
            "displayName": display_name,
            "role": role,
            "color": COLORS[len(self.participants) % len(COLORS)],
            "joinedAt": created,
            "leftAt": None,
            "updatedAt": created,
        }
        self.participants.append(participant)
        return participant

    def _membership(self, session_id: str, user_id: str) -> dict[str, Any] | None:
        return next((item for item in self.memberships if item["sessionId"] == session_id and item["userId"] == user_id), None)

    def _membership_row(self, session_id: str, user_id: str, role: str, created: str) -> dict[str, Any]:
        return {"sessionId": session_id, "userId": user_id, "role": role, "createdAt": created, "updatedAt": created}

    def _document_row(self, session_id: str, state: dict[str, Any], created: str) -> dict[str, Any]:
        return {
            "id": new_token()[:16],
            "sessionId": session_id,
            "schemaVersion": 1,
            "latestSnapshotId": None,
            "cursor": 0,
            "epoch": state["epoch"],
            "state": state,
            "updatedAt": created,
        }

    def _require_session(self, session_id: str) -> dict[str, Any]:
        session = next((item for item in self.sessions if item["id"] == session_id), None)
        if session is None:
            raise ApiError("not_found", "This interview could not be found.", 404)
        return session

    def _document(self, session_id: str) -> dict[str, Any]:
        document = next((item for item in self.documents if item["sessionId"] == session_id), None)
        if document is None:
            raise ApiError("not_found", "This canvas could not be found.", 404)
        return document

    def _list_item(self, session: dict[str, Any], role: str) -> dict[str, Any]:
        names = [item["displayName"] for item in self.participants if item["sessionId"] == session["id"] and not item["leftAt"]]
        active_link = any(
            link["sessionId"] == session["id"] and link["roleGranted"] == "candidate" and link["revokedAt"] is None
            for link in self.guest_links
        )
        return {
            "id": session["id"],
            "title": session["title"],
            "state": session["state"],
            "createdAt": session["createdAt"],
            "updatedAt": session["updatedAt"],
            "scheduledAt": session["scheduledAt"],
            "startedAt": session["startedAt"],
            "endedAt": session["endedAt"],
            "participantNames": names,
            "role": role,
            "hasActiveGuestLink": active_link,
        }

    def _detail(self, session: dict[str, Any], role: str, participant_id: str) -> dict[str, Any]:
        document = self._document(session["id"])
        links = [
            {
                "id": link["id"],
                "roleGranted": link["roleGranted"],
                "expiresAt": link["expiresAt"],
                "maxUses": link["maxUses"],
                "useCount": link["useCount"],
                "revokedAt": link["revokedAt"],
                "createdAt": link["createdAt"],
                "hasLocalToken": False,
            }
            for link in self.guest_links
            if link["sessionId"] == session["id"]
        ]
        snapshots = [
            {
                "id": item["id"],
                "operationCursor": item["operationCursor"],
                "createdAt": item["createdAt"],
                "checksum": item["checksum"],
            }
            for item in self.snapshots
            if item["canvasDocumentId"] == document["id"]
        ]
        return {
            "session": deepcopy(session),
            "participants": [deepcopy(item) for item in self.participants if item["sessionId"] == session["id"]],
            "myRole": role,
            "myParticipantId": participant_id,
            "links": links,
            "snapshots": snapshots,
        }

    def _join_result(self, session: dict[str, Any], participant: dict[str, Any]) -> dict[str, Any]:
        return {
            "sessionId": session["id"],
            "title": session["title"],
            "prompt": session["prompt"],
            "state": session["state"],
            "participant": deepcopy(participant),
            "candidateEditingEnabled": session["candidateEditingEnabled"],
            "cursorVisibility": session["cursorVisibility"],
            "durationMinutes": session["durationMinutes"],
            "startedAt": session["startedAt"],
        }

    def _lookup_join(self, token: str) -> tuple[dict[str, Any], dict[str, Any]]:
        self._consume_rate(f"join:{sha256_hex(token)}", 30, timedelta(minutes=1))
        link = next((item for item in self.guest_links if item["tokenHash"] == sha256_hex(token)), None)
        if link is None:
            raise ApiError("not_found", "This link is not valid. Check the address with your interviewer.", 404)
        session = self._require_session(link["sessionId"])
        if link["revokedAt"]:
            raise ApiError("revoked", "This link has been revoked. Ask the interviewer for a new one.", 403)
        if link["expiresAt"] and parse_time(link["expiresAt"]) <= datetime.now(timezone.utc):
            raise ApiError("expired", "This link has expired.", 403)
        if link["maxUses"] is not None and link["useCount"] >= link["maxUses"]:
            raise ApiError("expired", "This link has already been used.", 403)
        if session["state"] == "ended":
            raise ApiError("ended", "This interview has ended.", 403)
        if session["state"] == "archived":
            raise ApiError("archived", "This interview has been archived.", 403)
        active = sum(1 for item in self.participants if item["sessionId"] == session["id"] and not item["leftAt"])
        if active >= session["maxParticipants"]:
            raise ApiError("capacity", "This interview is full.", 403)
        return session, link

    def _replaced(self, session_id: str) -> tuple[str, dict[str, Any]]:
        session = self._require_session(session_id)
        document = self._document(session_id)
        return (
            session_id,
            {
                "type": "canvas_replaced",
                "document": deepcopy(document["state"]),
                "cursor": document["cursor"],
                "epoch": document["epoch"],
                "session": deepcopy(session),
            },
        )

    def _write_snapshot(self, session_id: str) -> str:
        document = self._document(session_id)
        blob = deepcopy(document["state"])
        storage_key = new_token()
        checksum = sha256_hex(stable_json(blob))
        snapshot_id = new_token()[:16]
        self.blobs[storage_key] = blob
        self.snapshots.append(
            {
                "id": snapshot_id,
                "canvasDocumentId": document["id"],
                "operationCursor": document["cursor"],
                "storageKey": storage_key,
                "checksum": checksum,
                "createdAt": now_iso(),
            }
        )
        document["latestSnapshotId"] = snapshot_id
        return snapshot_id

    def _record_op(self, document: dict[str, Any], actor_id: str, client_operation_id: str, op: dict[str, Any]) -> None:
        self.operations.append(
            {
                "id": new_token()[:16],
                "canvasDocumentId": document["id"],
                "actorId": actor_id,
                "clientOperationId": client_operation_id,
                "payload": op,
                "serverReceivedAt": document["updatedAt"],
                "cursor": document["cursor"],
            }
        )

    def _audit(self, session_id: str, actor_id: str, event_type: str, detail: str) -> None:
        self.audit.append(
            {"id": new_token()[:16], "sessionId": session_id, "actorId": actor_id, "type": event_type, "at": now_iso(), "detail": detail}
        )

    def _consume_rate(self, key: str, limit: int, window: timedelta) -> None:
        cutoff = datetime.now(timezone.utc) - window
        self.rate_events = [item for item in self.rate_events if parse_time(item["at"]) >= cutoff]
        count = sum(1 for item in self.rate_events if item["key"] == key)
        if count >= limit:
            raise ApiError("rate_limited", "Too many attempts. Wait a moment and try again.", 429)
        self.rate_events.append({"key": key, "at": now_iso()})

    def _iso_after(self, delta: timedelta) -> str:
        return (datetime.now(timezone.utc) + delta).isoformat(timespec="milliseconds").replace("+00:00", "Z")

    def _clean(self, value: str, limit: int) -> str:
        cleaned = "".join(ch for ch in value if ch >= " " or ch in "\n\t")
        return cleaned[:limit]

    def _duration(self, value: Any) -> int | None:
        if value is None or value == 0:
            return None
        if not isinstance(value, int) or value < 5 or value > 240:
            raise ApiError("invalid", "Duration must be between 5 and 240 minutes.")
        return value

    def _schedule(self, value: Any) -> str | None:
        if value is None or value == "":
            return None
        try:
            parsed = parse_time(value)
        except (TypeError, ValueError):
            raise ApiError("invalid", "Scheduled time is not valid.") from None
        return parsed.isoformat(timespec="milliseconds").replace("+00:00", "Z")

    def _assert_document(self, document: dict[str, Any]) -> None:
        if document.get("schemaVersion") != 1 or "elements" not in document or "connectors" not in document or "strokes" not in document:
            raise ApiError("invalid", "This canvas template is unsupported.")

    def _within_limits(self, state: dict[str, Any]) -> str | None:
        elements = sum(1 for item in state["elements"].values() if not (item.get("tomb") or {}).get("v"))
        if elements > ELEMENT_LIMIT:
            return "This canvas has reached the 2,000 element limit."
        points = 0
        for stroke in state["strokes"].values():
            if (stroke.get("tomb") or {}).get("v"):
                continue
            points += len((stroke.get("points") or {}).get("v") or [])
        if points > STROKE_POINT_LIMIT:
            return "This canvas has reached the freehand point limit."
        return None

    def _assert_can_view(self, role: str, session: dict[str, Any]) -> None:
        if self._can(role, "view_canvas", session):
            return
        if session["state"] == "ended":
            raise ApiError("ended", "This interview has ended.", 403)
        if session["state"] == "archived":
            raise ApiError("archived", "This interview has been archived.", 403)
        raise ApiError("forbidden", "You cannot view this interview.", 403)

    def _assert_can_edit(self, role: str, session: dict[str, Any]) -> None:
        if session["state"] in {"ended", "archived"}:
            raise ApiError("ended", "This interview is read-only.", 403)
        if role == "candidate" and not session["candidateEditingEnabled"]:
            raise ApiError("locked", "The interviewer has locked candidate editing.", 403)
        if not self._can(role, "edit_canvas", session):
            raise ApiError("forbidden", "You cannot edit this canvas.", 403)

    def _can(self, role: str, capability: str, session: dict[str, Any]) -> bool:
        closed = session["state"] in {"ended", "archived"}
        if capability in {"view_canvas", "export"}:
            return role != "candidate" if closed else True
        if capability == "edit_canvas":
            if closed or role == "observer":
                return False
            if role == "candidate":
                return bool(session["candidateEditingEnabled"])
            return role in {"owner", "interviewer"}
        return False


def clock_compare(left: dict[str, Any], right: dict[str, Any]) -> int:
    if left["t"] != right["t"]:
        return -1 if left["t"] < right["t"] else 1
    if left["a"] == right["a"]:
        return 0
    return -1 if left["a"] < right["a"] else 1


def merge_reg(left: dict[str, Any] | None, right: dict[str, Any] | None) -> dict[str, Any] | None:
    if left is None:
        return right
    if right is None:
        return left
    return left if clock_compare(left["c"], right["c"]) >= 0 else right


def merge_entity(left: dict[str, Any], right: dict[str, Any], fields: tuple[str, ...]) -> dict[str, Any]:
    merged: dict[str, Any] = {"id": left["id"]}
    created = left.get("createdBy") or right.get("createdBy")
    if created:
        merged["createdBy"] = created
    for field in fields:
        value = merge_reg(left.get(field), right.get(field))
        if value is not None:
            merged[field] = value
    return merged


def apply_patches(current: dict[str, Any], patches: list[dict[str, Any]] | None, fields: tuple[str, ...]) -> dict[str, Any]:
    if not patches:
        return current
    nxt = dict(current)
    for patch in patches:
        existing = nxt.get(patch["id"])
        nxt[patch["id"]] = merge_entity(existing, patch, fields) if existing else patch
    return nxt


def apply_canvas_op(state: dict[str, Any], op: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    if op.get("kind") == "restore":
        restored = op.get("state")
        epoch = op.get("epoch", -1)
        if not isinstance(restored, dict) or epoch < state["epoch"]:
            return state, False
        restored = {**deepcopy(restored), "schemaVersion": 1, "epoch": epoch}
        if epoch == state["epoch"]:
            return merge_docs(state, restored), True
        return restored, True
    if op.get("epoch") != state["epoch"]:
        return state, False
    return (
        {
            **state,
            "elements": apply_patches(state["elements"], op.get("elements"), ELEMENT_FIELDS),
            "connectors": apply_patches(state["connectors"], op.get("connectors"), CONNECTOR_FIELDS),
            "strokes": apply_patches(state["strokes"], op.get("strokes"), STROKE_FIELDS),
        },
        True,
    )


def merge_docs(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    if left["epoch"] != right["epoch"]:
        return left if left["epoch"] > right["epoch"] else right
    return {
        "schemaVersion": 1,
        "epoch": left["epoch"],
        "elements": merge_map(left["elements"], right["elements"], ELEMENT_FIELDS),
        "connectors": merge_map(left["connectors"], right["connectors"], CONNECTOR_FIELDS),
        "strokes": merge_map(left["strokes"], right["strokes"], STROKE_FIELDS),
    }


def merge_map(left: dict[str, Any], right: dict[str, Any], fields: tuple[str, ...]) -> dict[str, Any]:
    merged = {}
    for item_id in set(left) | set(right):
        if item_id in left and item_id in right:
            merged[item_id] = merge_entity(left[item_id], right[item_id], fields)
        else:
            merged[item_id] = left.get(item_id) or right[item_id]
    return merged


def validate_op(op: dict[str, Any]) -> str | None:
    if op.get("kind") == "restore":
        state = op.get("state")
        if not isinstance(state, dict) or state.get("schemaVersion") != 1:
            return "Canvas snapshot is unsupported."
        return None
    if op.get("kind") != "patch":
        return "Unsupported canvas operation."
    for element in op.get("elements") or []:
        if "id" not in element:
            return "Canvas object is missing an id."
        kind = (element.get("type") or {}).get("v")
        if kind is not None and kind not in COMPONENT_TYPES:
            return "Unsupported component type."
        label = (element.get("label") or {}).get("v")
        if isinstance(label, str) and len(label) > LABEL_MAX:
            return "Labels must be 500 characters or fewer."
        description = (element.get("description") or {}).get("v")
        if isinstance(description, str) and len(description) > DESCRIPTION_MAX:
            return "Descriptions must be 2,000 characters or fewer."
        width = (element.get("width") or {}).get("v")
        height = (element.get("height") or {}).get("v")
        if isinstance(width, (int, float)) and (width <= 0 or width > 8000):
            return "Element size is out of range."
        if isinstance(height, (int, float)) and (height <= 0 or height > 8000):
            return "Element size is out of range."
    for connector in op.get("connectors") or []:
        label = (connector.get("label") or {}).get("v")
        if isinstance(label, str) and len(label) > LABEL_MAX:
            return "Connector labels must be 500 characters or fewer."
        width = (connector.get("width") or {}).get("v")
        if width is not None and width not in {1, 2, 3}:
            return "Unsupported connector width."
    for stroke in op.get("strokes") or []:
        points = (stroke.get("points") or {}).get("v") or []
        if len(points) > STROKE_POINTS_MAX:
            return "A freehand stroke is too long."
    return None
