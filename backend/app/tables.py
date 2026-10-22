from sqlalchemy import JSON, Integer, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class UserRecord(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    email: Mapped[str] = mapped_column(Text, unique=True, index=True)
    display_name: Mapped[str] = mapped_column(Text)
    organization_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(Text)
    password_hash: Mapped[str] = mapped_column(Text)


class MagicLinkRecord(Base):
    __tablename__ = "magic_links"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    token_hash: Mapped[str] = mapped_column(Text, unique=True, index=True)
    email: Mapped[str] = mapped_column(Text, index=True)
    expires_at: Mapped[str] = mapped_column(Text)
    used_at: Mapped[str | None] = mapped_column(Text, nullable=True)


class SessionRecord(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(Text, index=True)
    title: Mapped[str] = mapped_column(Text)
    prompt: Mapped[str] = mapped_column(Text)
    state: Mapped[str] = mapped_column(Text)
    candidate_editing_enabled: Mapped[bool] = mapped_column()
    cursor_visibility: Mapped[bool] = mapped_column()
    duration_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    scheduled_at: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[str | None] = mapped_column(Text, nullable=True)
    ended_at: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[str] = mapped_column(Text, index=True)
    max_participants: Mapped[int] = mapped_column(Integer)


class MembershipRecord(Base):
    __tablename__ = "memberships"
    __table_args__ = (UniqueConstraint("session_id", "user_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(Text, index=True)
    user_id: Mapped[str] = mapped_column(Text, index=True)
    role: Mapped[str] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[str] = mapped_column(Text)


class InviteRecord(Base):
    __tablename__ = "invites"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    session_id: Mapped[str] = mapped_column(Text, index=True)
    email: Mapped[str] = mapped_column(Text, index=True)
    role: Mapped[str] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(Text)


class GuestLinkRecord(Base):
    __tablename__ = "guest_links"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    session_id: Mapped[str] = mapped_column(Text, index=True)
    token_hash: Mapped[str] = mapped_column(Text, unique=True, index=True)
    role_granted: Mapped[str] = mapped_column(Text)
    expires_at: Mapped[str | None] = mapped_column(Text, nullable=True)
    max_uses: Mapped[int | None] = mapped_column(Integer, nullable=True)
    use_count: Mapped[int] = mapped_column(Integer)
    revoked_at: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(Text)


class ParticipantRecord(Base):
    __tablename__ = "participants"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    session_id: Mapped[str] = mapped_column(Text, index=True)
    user_id: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    guest_link_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    display_name: Mapped[str] = mapped_column(Text)
    role: Mapped[str] = mapped_column(Text)
    color: Mapped[str] = mapped_column(Text)
    joined_at: Mapped[str] = mapped_column(Text)
    left_at: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[str] = mapped_column(Text)


class DocumentRecord(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    session_id: Mapped[str] = mapped_column(Text, unique=True, index=True)
    schema_version: Mapped[int] = mapped_column(Integer)
    latest_snapshot_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    cursor: Mapped[int] = mapped_column(Integer)
    epoch: Mapped[int] = mapped_column(Integer)
    state: Mapped[dict] = mapped_column(JSON)
    updated_at: Mapped[str] = mapped_column(Text)


class OperationRecord(Base):
    __tablename__ = "operations"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    canvas_document_id: Mapped[str] = mapped_column(Text, index=True)
    actor_id: Mapped[str] = mapped_column(Text)
    client_operation_id: Mapped[str] = mapped_column(Text, index=True)
    payload: Mapped[dict] = mapped_column(JSON)
    server_received_at: Mapped[str] = mapped_column(Text)
    cursor: Mapped[int] = mapped_column(Integer)


class SnapshotRecord(Base):
    __tablename__ = "snapshots"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    canvas_document_id: Mapped[str] = mapped_column(Text, index=True)
    operation_cursor: Mapped[int] = mapped_column(Integer)
    storage_key: Mapped[str] = mapped_column(Text, unique=True)
    checksum: Mapped[str] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(Text)


class BlobRecord(Base):
    __tablename__ = "blobs"

    storage_key: Mapped[str] = mapped_column(Text, primary_key=True)
    body: Mapped[dict] = mapped_column(JSON)


class AuditRecord(Base):
    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    session_id: Mapped[str] = mapped_column(Text, index=True)
    actor_id: Mapped[str] = mapped_column(Text)
    event_type: Mapped[str] = mapped_column(Text)
    at: Mapped[str] = mapped_column(Text)
    detail: Mapped[str] = mapped_column(Text)


class CredentialRecord(Base):
    __tablename__ = "credentials"

    token_hash: Mapped[str] = mapped_column(Text, primary_key=True)
    participant_id: Mapped[str] = mapped_column(Text, index=True)
    session_id: Mapped[str] = mapped_column(Text, index=True)
    expires_at: Mapped[str] = mapped_column(Text)
    revoked_at: Mapped[str | None] = mapped_column(Text, nullable=True)


class AccessTokenRecord(Base):
    __tablename__ = "access_tokens"

    token_hash: Mapped[str] = mapped_column(Text, primary_key=True)
    payload: Mapped[dict] = mapped_column(JSON)


class RateEventRecord(Base):
    __tablename__ = "rate_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(Text, index=True)
    at: Mapped[str] = mapped_column(Text)
