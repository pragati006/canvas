from fastapi import APIRouter, Request, Response

from app.auth import bearer_token
from app.models import ApiError, CanvasBundle, CanvasExport, ClearCanvasResult
from app.routers.collaboration import publish

router = APIRouter(tags=["Canvas"])


def _token(request: Request) -> tuple[str, str]:
    raw = bearer_token(request)
    if not raw:
        raise ApiError("unauthorized", "Sign in to continue.", 401)
    return raw, request.headers.get("x-lattice-actor", "user")


@router.get("/sessions/{sessionId}/canvas", response_model=CanvasBundle)
def get_canvas(sessionId: str, request: Request) -> dict:
    raw, mode = _token(request)
    return request.app.state.store.get_canvas(raw, sessionId, mode)


@router.post("/sessions/{sessionId}/canvas/clear", response_model=ClearCanvasResult)
async def clear_canvas(sessionId: str, request: Request) -> dict:
    from app.auth import require_user

    user = require_user(request)
    result, events = request.app.state.store.clear_canvas(user, sessionId)
    await publish(request, events)
    return result


@router.post("/sessions/{sessionId}/snapshots/{snapshotId}/restore", status_code=204)
async def restore_snapshot(sessionId: str, snapshotId: str, request: Request) -> Response:
    from app.auth import require_user

    user = require_user(request)
    events = request.app.state.store.restore_snapshot(user, sessionId, snapshotId)
    await publish(request, events)
    return Response(status_code=204)


@router.get("/sessions/{sessionId}/export", response_model=CanvasExport)
def export_canvas(sessionId: str, request: Request) -> dict:
    raw, mode = _token(request)
    return request.app.state.store.export_canvas(raw, sessionId, mode)
