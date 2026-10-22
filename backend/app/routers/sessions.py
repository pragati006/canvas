from fastapi import APIRouter, Request

from app.auth import bearer_token, require_user
from app.models import (
    AuditEvent,
    CreateSessionInput,
    Session,
    SessionDetail,
    SessionListItem,
    UpdateSessionInput,
)
from app.routers.collaboration import publish

router = APIRouter(tags=["Sessions"])


@router.get("/sessions", response_model=list[SessionListItem])
def list_sessions(request: Request) -> list:
    user = require_user(request)
    return request.app.state.store.list_sessions(user["id"])


@router.post("/sessions", response_model=Session, status_code=201)
def create_session(body: CreateSessionInput, request: Request) -> dict:
    user = require_user(request)
    return request.app.state.store.create_session(user, body.model_dump(exclude_unset=True))


@router.get("/sessions/{sessionId}", response_model=SessionDetail)
def get_session(sessionId: str, request: Request) -> dict:
    raw = bearer_token(request)
    mode = request.headers.get("x-lattice-actor", "user")
    if not raw:
        from app.models import ApiError

        raise ApiError("unauthorized", "Sign in to continue.", 401)
    return request.app.state.store.get_session(raw, sessionId, mode)


@router.patch("/sessions/{sessionId}", response_model=Session)
async def update_session(sessionId: str, body: UpdateSessionInput, request: Request) -> dict:
    user = require_user(request)
    session, events = request.app.state.store.update_session(user, sessionId, body.model_dump(exclude_unset=True))
    await publish(request, events)
    return session


@router.post("/sessions/{sessionId}/start", response_model=Session)
async def start_session(sessionId: str, request: Request) -> dict:
    user = require_user(request)
    session, events = request.app.state.store.start_session(user, sessionId)
    await publish(request, events)
    return session


@router.post("/sessions/{sessionId}/end", response_model=Session)
async def end_session(sessionId: str, request: Request) -> dict:
    user = require_user(request)
    session, events = request.app.state.store.end_session(user, sessionId)
    await publish(request, events)
    return session


@router.post("/sessions/{sessionId}/archive", response_model=Session)
async def archive_session(sessionId: str, request: Request) -> dict:
    user = require_user(request)
    session, events = request.app.state.store.archive_session(user, sessionId)
    await publish(request, events)
    return session


@router.post("/sessions/{sessionId}/duplicate", response_model=Session, status_code=201)
def duplicate_session(sessionId: str, request: Request) -> dict:
    user = require_user(request)
    return request.app.state.store.duplicate_session(user, sessionId)


@router.get("/sessions/{sessionId}/audit", response_model=list[AuditEvent])
def list_audit(sessionId: str, request: Request) -> list:
    from app.models import ApiError

    raw = bearer_token(request)
    if not raw:
        raise ApiError("unauthorized", "Sign in to continue.", 401)
    mode = request.headers.get("x-lattice-actor", "user")
    return request.app.state.store.list_audit(raw, sessionId, mode)
