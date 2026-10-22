from fastapi import APIRouter, Request, Response

from app.auth import bearer_token, optional_user
from app.models import (
    CompleteMagicLinkRequest,
    LoginRequest,
    MagicLinkRequest,
    MagicLinkResponse,
    TokenResponse,
    User,
)

router = APIRouter(tags=["Auth"])


@router.post("/auth/login", response_model=TokenResponse)
def login(body: LoginRequest, request: Request) -> TokenResponse:
    user, token = request.app.state.store.login(body.email, body.password)
    return TokenResponse(accessToken=token, user=User.model_validate(user))


@router.post("/auth/magic-links", response_model=MagicLinkResponse)
def request_magic_link(body: MagicLinkRequest, request: Request) -> dict:
    return request.app.state.store.request_magic_link(body.email)


@router.post("/auth/magic-links/complete", response_model=User)
def complete_magic_link(body: CompleteMagicLinkRequest, request: Request, response: Response) -> dict:
    user, token = request.app.state.store.complete_magic_link(body.token)
    response.headers["X-Access-Token"] = token
    return user


@router.get("/me", response_model=User | None)
def current_user(request: Request) -> dict | None:
    return optional_user(request)


@router.post("/auth/sign-out", status_code=204)
def sign_out(request: Request) -> Response:
    from app.models import ApiError

    raw = bearer_token(request)
    if not raw:
        raise ApiError("unauthorized", "Sign in to continue.", 401)
    request.app.state.store.revoke_token(raw)
    return Response(status_code=204)
