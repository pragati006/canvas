import hashlib
import hmac
import re
import secrets
from dataclasses import dataclass

from fastapi import Request

from app.models import ApiError

PBKDF2_ROUNDS = 210_000
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ROUNDS)
    return f"pbkdf2_sha256${PBKDF2_ROUNDS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, rounds, salt_hex, digest_hex = stored.split("$")
        if algorithm != "pbkdf2_sha256":
            return False
        check = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(rounds))
        return hmac.compare_digest(check.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def new_token() -> str:
    return secrets.token_hex(32)


def bearer_token(request: Request) -> str | None:
    header = request.headers.get("authorization")
    if not header:
        return None
    scheme, _, value = header.partition(" ")
    if scheme.lower() != "bearer" or not value.strip():
        return None
    return value.strip()


def normalize_email(email: str) -> str:
    normalized = email.strip().lower()
    if not EMAIL_RE.fullmatch(normalized):
        raise ApiError("invalid", "Enter a valid email address.")
    return normalized


@dataclass
class Actor:
    kind: str
    role: str
    user_id: str | None
    participant_id: str
    session_id: str


def require_user(request: Request) -> dict:
    store = request.app.state.store
    raw = bearer_token(request)
    if not raw:
        raise ApiError("unauthorized", "Sign in to continue.", 401)
    user = store.user_for_token(raw)
    if user is None:
        raise ApiError("unauthorized", "Sign in to continue.", 401)
    return user


def optional_user(request: Request) -> dict | None:
    store = request.app.state.store
    raw = bearer_token(request)
    if not raw:
        return None
    return store.user_for_token(raw)


def require_actor(request: Request, session_id: str) -> Actor:
    store = request.app.state.store
    raw = bearer_token(request)
    if not raw:
        raise ApiError("unauthorized", "Sign in to continue.", 401)
    mode = request.headers.get("x-lattice-actor", "user")
    return store.resolve_actor(raw, session_id, mode)
