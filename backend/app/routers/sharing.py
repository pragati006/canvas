from fastapi import APIRouter, Body, Request, Response

from app.auth import require_user
from app.models import CreateLinkInput, InviteRequest, IssuedLink, Session
from app.routers.collaboration import publish

router = APIRouter(tags=["Sharing"])


@router.post("/sessions/{sessionId}/guest-links", response_model=IssuedLink, status_code=201)
def create_guest_link(
    sessionId: str,
    request: Request,
    body: CreateLinkInput | None = Body(default=None),
) -> dict:
    user = require_user(request)
    payload = body.model_dump(exclude_unset=True) if body else {}
    return request.app.state.store.create_guest_link(user, sessionId, payload)


@router.delete("/sessions/{sessionId}/guest-links/{linkId}", status_code=204)
def revoke_guest_link(sessionId: str, linkId: str, request: Request) -> Response:
    user = require_user(request)
    request.app.state.store.revoke_guest_link(user, sessionId, linkId)
    return Response(status_code=204)


@router.post("/sessions/{sessionId}/invites", status_code=204)
def invite(sessionId: str, body: InviteRequest, request: Request) -> Response:
    user = require_user(request)
    request.app.state.store.invite(user, sessionId, body.email, body.role)
    return Response(status_code=204)


@router.delete("/sessions/{sessionId}/participants/{participantId}", status_code=204)
async def remove_participant(sessionId: str, participantId: str, request: Request) -> Response:
    user = require_user(request)
    events = request.app.state.store.remove_participant(user, sessionId, participantId)
    await publish(request, events)
    return Response(status_code=204)


@router.put("/sessions/{sessionId}/candidate-editing", response_model=Session)
async def set_candidate_editing(sessionId: str, request: Request, body: dict) -> dict:
    from app.models import StrictModel

    class EditingBody(StrictModel):
        enabled: bool

    parsed = EditingBody.model_validate(body)
    user = require_user(request)
    session, events = request.app.state.store.set_candidate_editing(user, sessionId, parsed.enabled)
    await publish(request, events)
    return session


@router.put("/sessions/{sessionId}/cursor-visibility", response_model=Session)
async def set_cursor_visibility(sessionId: str, request: Request, body: dict) -> dict:
    from app.models import StrictModel

    class VisibilityBody(StrictModel):
        visible: bool

    parsed = VisibilityBody.model_validate(body)
    user = require_user(request)
    session, events = request.app.state.store.set_cursor_visibility(user, sessionId, parsed.visible)
    await publish(request, events)
    return session
