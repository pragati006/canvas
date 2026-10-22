from copy import deepcopy
from typing import Any

from sqlalchemy import delete, select

from app.database import session_scope
from app.tables import (
    AccessTokenRecord,
    AuditRecord,
    BlobRecord,
    CredentialRecord,
    DocumentRecord,
    GuestLinkRecord,
    InviteRecord,
    MagicLinkRecord,
    MembershipRecord,
    OperationRecord,
    ParticipantRecord,
    RateEventRecord,
    SessionRecord,
    SnapshotRecord,
    UserRecord,
)

TABLES = (
    RateEventRecord,
    AccessTokenRecord,
    CredentialRecord,
    AuditRecord,
    BlobRecord,
    SnapshotRecord,
    OperationRecord,
    DocumentRecord,
    ParticipantRecord,
    GuestLinkRecord,
    InviteRecord,
    MembershipRecord,
    MagicLinkRecord,
    SessionRecord,
    UserRecord,
)


def _copy(value: Any) -> Any:
    return deepcopy(value)


def load_state() -> dict[str, Any]:
    with session_scope() as db:
        users = [
            {
                "id": row.id,
                "email": row.email,
                "displayName": row.display_name,
                "organizationId": row.organization_id,
                "createdAt": row.created_at,
                "passwordHash": row.password_hash,
            }
            for row in db.scalars(select(UserRecord).order_by(UserRecord.created_at, UserRecord.email))
        ]
        magic_links = [
            {
                "id": row.id,
                "tokenHash": row.token_hash,
                "email": row.email,
                "expiresAt": row.expires_at,
                "usedAt": row.used_at,
            }
            for row in db.scalars(select(MagicLinkRecord))
        ]
        sessions = [
            {
                "id": row.id,
                "ownerUserId": row.owner_user_id,
                "title": row.title,
                "prompt": row.prompt,
                "state": row.state,
                "candidateEditingEnabled": row.candidate_editing_enabled,
                "cursorVisibility": row.cursor_visibility,
                "durationMinutes": row.duration_minutes,
                "scheduledAt": row.scheduled_at,
                "startedAt": row.started_at,
                "endedAt": row.ended_at,
                "createdAt": row.created_at,
                "updatedAt": row.updated_at,
                "maxParticipants": row.max_participants,
            }
            for row in db.scalars(select(SessionRecord))
        ]
        memberships = [
            {
                "sessionId": row.session_id,
                "userId": row.user_id,
                "role": row.role,
                "createdAt": row.created_at,
                "updatedAt": row.updated_at,
            }
            for row in db.scalars(select(MembershipRecord))
        ]
        invites = [
            {
                "id": row.id,
                "sessionId": row.session_id,
                "email": row.email,
                "role": row.role,
                "createdAt": row.created_at,
            }
            for row in db.scalars(select(InviteRecord))
        ]
        guest_links = [
            {
                "id": row.id,
                "sessionId": row.session_id,
                "tokenHash": row.token_hash,
                "roleGranted": row.role_granted,
                "expiresAt": row.expires_at,
                "maxUses": row.max_uses,
                "useCount": row.use_count,
                "revokedAt": row.revoked_at,
                "createdAt": row.created_at,
            }
            for row in db.scalars(select(GuestLinkRecord))
        ]
        participants = [
            {
                "id": row.id,
                "sessionId": row.session_id,
                "userId": row.user_id,
                "guestLinkId": row.guest_link_id,
                "displayName": row.display_name,
                "role": row.role,
                "color": row.color,
                "joinedAt": row.joined_at,
                "leftAt": row.left_at,
                "updatedAt": row.updated_at,
            }
            for row in db.scalars(select(ParticipantRecord))
        ]
        documents = [
            {
                "id": row.id,
                "sessionId": row.session_id,
                "schemaVersion": row.schema_version,
                "latestSnapshotId": row.latest_snapshot_id,
                "cursor": row.cursor,
                "epoch": row.epoch,
                "state": _copy(row.state),
                "updatedAt": row.updated_at,
            }
            for row in db.scalars(select(DocumentRecord))
        ]
        operations = [
            {
                "id": row.id,
                "canvasDocumentId": row.canvas_document_id,
                "actorId": row.actor_id,
                "clientOperationId": row.client_operation_id,
                "payload": _copy(row.payload),
                "serverReceivedAt": row.server_received_at,
                "cursor": row.cursor,
            }
            for row in db.scalars(select(OperationRecord))
        ]
        snapshots = [
            {
                "id": row.id,
                "canvasDocumentId": row.canvas_document_id,
                "operationCursor": row.operation_cursor,
                "storageKey": row.storage_key,
                "checksum": row.checksum,
                "createdAt": row.created_at,
            }
            for row in db.scalars(select(SnapshotRecord))
        ]
        blobs = {row.storage_key: _copy(row.body) for row in db.scalars(select(BlobRecord))}
        audit = [
            {
                "id": row.id,
                "sessionId": row.session_id,
                "actorId": row.actor_id,
                "type": row.event_type,
                "at": row.at,
                "detail": row.detail,
            }
            for row in db.scalars(select(AuditRecord))
        ]
        credentials = [
            {
                "tokenHash": row.token_hash,
                "participantId": row.participant_id,
                "sessionId": row.session_id,
                "expiresAt": row.expires_at,
                "revokedAt": row.revoked_at,
            }
            for row in db.scalars(select(CredentialRecord))
        ]
        tokens = {row.token_hash: _copy(row.payload) for row in db.scalars(select(AccessTokenRecord))}
        rate_events = [{"key": row.key, "at": row.at} for row in db.scalars(select(RateEventRecord))]
    return {
        "users": users,
        "magic_links": magic_links,
        "sessions": sessions,
        "memberships": memberships,
        "invites": invites,
        "guest_links": guest_links,
        "participants": participants,
        "documents": documents,
        "operations": operations,
        "snapshots": snapshots,
        "blobs": blobs,
        "audit": audit,
        "credentials": credentials,
        "tokens": tokens,
        "rate_events": rate_events,
    }


def save_state(state: dict[str, Any]) -> None:
    with session_scope() as db:
        for model in TABLES:
            db.execute(delete(model))
        db.add_all(
            UserRecord(
                id=item["id"],
                email=item["email"],
                display_name=item["displayName"],
                organization_id=item.get("organizationId"),
                created_at=item["createdAt"],
                password_hash=item["passwordHash"],
            )
            for item in state["users"]
        )
        db.add_all(
            MagicLinkRecord(
                id=item["id"],
                token_hash=item["tokenHash"],
                email=item["email"],
                expires_at=item["expiresAt"],
                used_at=item.get("usedAt"),
            )
            for item in state["magic_links"]
        )
        db.add_all(
            SessionRecord(
                id=item["id"],
                owner_user_id=item["ownerUserId"],
                title=item["title"],
                prompt=item["prompt"],
                state=item["state"],
                candidate_editing_enabled=bool(item["candidateEditingEnabled"]),
                cursor_visibility=bool(item["cursorVisibility"]),
                duration_minutes=item.get("durationMinutes"),
                scheduled_at=item.get("scheduledAt"),
                started_at=item.get("startedAt"),
                ended_at=item.get("endedAt"),
                created_at=item["createdAt"],
                updated_at=item["updatedAt"],
                max_participants=item["maxParticipants"],
            )
            for item in state["sessions"]
        )
        db.add_all(
            MembershipRecord(
                session_id=item["sessionId"],
                user_id=item["userId"],
                role=item["role"],
                created_at=item["createdAt"],
                updated_at=item["updatedAt"],
            )
            for item in state["memberships"]
        )
        db.add_all(
            InviteRecord(
                id=item["id"],
                session_id=item["sessionId"],
                email=item["email"],
                role=item["role"],
                created_at=item["createdAt"],
            )
            for item in state["invites"]
        )
        db.add_all(
            GuestLinkRecord(
                id=item["id"],
                session_id=item["sessionId"],
                token_hash=item["tokenHash"],
                role_granted=item["roleGranted"],
                expires_at=item.get("expiresAt"),
                max_uses=item.get("maxUses"),
                use_count=item["useCount"],
                revoked_at=item.get("revokedAt"),
                created_at=item["createdAt"],
            )
            for item in state["guest_links"]
        )
        db.add_all(
            ParticipantRecord(
                id=item["id"],
                session_id=item["sessionId"],
                user_id=item.get("userId"),
                guest_link_id=item.get("guestLinkId"),
                display_name=item["displayName"],
                role=item["role"],
                color=item["color"],
                joined_at=item["joinedAt"],
                left_at=item.get("leftAt"),
                updated_at=item["updatedAt"],
            )
            for item in state["participants"]
        )
        db.add_all(
            DocumentRecord(
                id=item["id"],
                session_id=item["sessionId"],
                schema_version=item["schemaVersion"],
                latest_snapshot_id=item.get("latestSnapshotId"),
                cursor=item["cursor"],
                epoch=item["epoch"],
                state=_copy(item["state"]),
                updated_at=item["updatedAt"],
            )
            for item in state["documents"]
        )
        db.add_all(
            OperationRecord(
                id=item["id"],
                canvas_document_id=item["canvasDocumentId"],
                actor_id=item["actorId"],
                client_operation_id=item["clientOperationId"],
                payload=_copy(item["payload"]),
                server_received_at=item["serverReceivedAt"],
                cursor=item["cursor"],
            )
            for item in state["operations"]
        )
        db.add_all(
            SnapshotRecord(
                id=item["id"],
                canvas_document_id=item["canvasDocumentId"],
                operation_cursor=item["operationCursor"],
                storage_key=item["storageKey"],
                checksum=item["checksum"],
                created_at=item["createdAt"],
            )
            for item in state["snapshots"]
        )
        db.add_all(BlobRecord(storage_key=key, body=_copy(body)) for key, body in state["blobs"].items())
        db.add_all(
            AuditRecord(
                id=item["id"],
                session_id=item["sessionId"],
                actor_id=item["actorId"],
                event_type=item["type"],
                at=item["at"],
                detail=item["detail"],
            )
            for item in state["audit"]
        )
        db.add_all(
            CredentialRecord(
                token_hash=item["tokenHash"],
                participant_id=item["participantId"],
                session_id=item["sessionId"],
                expires_at=item["expiresAt"],
                revoked_at=item.get("revokedAt"),
            )
            for item in state["credentials"]
        )
        db.add_all(AccessTokenRecord(token_hash=digest, payload=_copy(payload)) for digest, payload in state["tokens"].items())
        db.add_all(RateEventRecord(key=item["key"], at=item["at"]) for item in state["rate_events"])
