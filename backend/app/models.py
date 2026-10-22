from typing import Any, Literal, get_args

from pydantic import BaseModel, ConfigDict

SessionState = Literal["draft", "live", "ended", "archived"]
Role = Literal["owner", "interviewer", "candidate", "observer"]
GuestRole = Literal["candidate", "observer"]
MembershipRole = Literal["owner", "interviewer", "observer"]
ComponentType = Literal[
    "service",
    "rounded",
    "text",
    "sticky",
    "boundary",
    "icon",
    "rect",
    "ellipse",
    "sql",
    "nosql",
    "cache",
    "object-storage",
    "warehouse",
    "queue",
    "stream",
    "pubsub",
    "client",
    "browser",
    "gateway",
    "load-balancer",
    "cdn",
    "external-api",
    "server",
    "worker",
    "function",
    "container",
    "llm",
    "embedding",
    "vector-db",
    "agent",
]


class ApiError(Exception):
    def __init__(self, code: str, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class User(StrictModel):
    id: str
    email: str
    displayName: str
    organizationId: str | None
    createdAt: str


class TokenResponse(StrictModel):
    accessToken: str
    tokenType: Literal["bearer"] = "bearer"
    user: User


class LoginRequest(StrictModel):
    email: str
    password: str


class MagicLinkRequest(StrictModel):
    email: str


class MagicLinkResponse(StrictModel):
    verificationPath: str


class CompleteMagicLinkRequest(StrictModel):
    token: str


class Session(StrictModel):
    id: str
    ownerUserId: str
    title: str
    prompt: str
    state: SessionState
    candidateEditingEnabled: bool
    cursorVisibility: bool
    durationMinutes: int | None = None
    scheduledAt: str | None = None
    startedAt: str | None = None
    endedAt: str | None = None
    createdAt: str
    updatedAt: str
    maxParticipants: int


class SessionListItem(StrictModel):
    id: str
    title: str
    state: SessionState
    createdAt: str
    updatedAt: str
    scheduledAt: str | None
    startedAt: str | None
    endedAt: str | None
    participantNames: list[str]
    role: MembershipRole
    hasActiveGuestLink: bool


class Participant(StrictModel):
    id: str
    sessionId: str
    userId: str | None
    guestLinkId: str | None
    displayName: str
    role: Role
    color: str
    joinedAt: str
    leftAt: str | None
    updatedAt: str


class GuestLinkPublic(StrictModel):
    id: str
    roleGranted: GuestRole
    expiresAt: str | None
    maxUses: int | None
    useCount: int
    revokedAt: str | None
    createdAt: str
    hasLocalToken: bool


class SnapshotInfo(StrictModel):
    id: str
    operationCursor: int
    createdAt: str
    checksum: str


class SessionDetail(StrictModel):
    session: Session
    participants: list[Participant]
    myRole: Role
    myParticipantId: str
    links: list[GuestLinkPublic]
    snapshots: list[SnapshotInfo]


class CreateSessionInput(StrictModel):
    title: str
    prompt: str | None = None
    scheduledAt: str | None = None
    durationMinutes: int | None = None
    initialDocument: dict[str, Any] | None = None


class UpdateSessionInput(StrictModel):
    title: str | None = None
    prompt: str | None = None
    scheduledAt: str | None = None
    durationMinutes: int | None = None
    maxParticipants: int | None = None


class CreateLinkInput(StrictModel):
    roleGranted: GuestRole = "candidate"
    expiresAt: str | None = None
    maxUses: int | None = None


class IssuedLink(StrictModel):
    id: str
    sessionId: str
    roleGranted: GuestRole
    expiresAt: str | None
    maxUses: int | None
    createdAt: str
    token: str
    path: str


class InviteRequest(StrictModel):
    email: str
    role: Literal["interviewer", "observer"]


class JoinPreview(StrictModel):
    sessionId: str
    title: str
    state: SessionState


class JoinRequest(StrictModel):
    displayName: str
    acceptPrivacy: bool


class JoinResult(StrictModel):
    sessionId: str
    title: str
    prompt: str
    state: SessionState
    participant: Participant
    candidateEditingEnabled: bool
    cursorVisibility: bool
    durationMinutes: int | None
    startedAt: str | None


class CanvasBundle(StrictModel):
    schemaVersion: int
    cursor: int
    epoch: int
    document: dict[str, Any]


class CanvasExport(StrictModel):
    schemaVersion: int
    sessionId: str
    title: str
    exportedAt: str
    document: dict[str, Any]


class AuditEvent(StrictModel):
    id: str
    sessionId: str
    actorId: str
    type: str
    at: str
    detail: str


class ClearCanvasResult(StrictModel):
    snapshotId: str


class ErrorBody(StrictModel):
    code: str
    message: str


COMPONENT_TYPES = set(get_args(ComponentType))
TOKEN_PATTERN = r"^[0-9a-f]{64}$"
LABEL_MAX = 500
DESCRIPTION_MAX = 2000
ELEMENT_LIMIT = 2000
STROKE_POINT_LIMIT = 10_000
STROKE_POINTS_MAX = 2000
OP_BYTES_MAX = 500_000
