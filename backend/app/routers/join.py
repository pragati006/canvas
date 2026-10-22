from fastapi import APIRouter, Request, Response

from app.auth import bearer_token
from app.models import JoinPreview, JoinRequest, JoinResult

router = APIRouter(tags=["Join"])


@router.get("/join/{token}", response_model=JoinPreview)
def preview_join(token: str, request: Request) -> dict:
    return request.app.state.store.preview_join(token)


@router.post("/join/{token}", response_model=JoinResult)
def join(token: str, body: JoinRequest, request: Request, response: Response) -> dict:
    result, access_token = request.app.state.store.join(token, body.displayName, body.acceptPrivacy)
    response.headers["X-Access-Token"] = access_token
    return result


@router.post("/sessions/{sessionId}/guest", response_model=JoinResult | None)
def restore_guest(sessionId: str, request: Request) -> dict | None:
    return request.app.state.store.restore_guest(bearer_token(request), sessionId)
