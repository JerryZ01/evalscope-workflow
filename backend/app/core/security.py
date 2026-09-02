"""Optional shared-token authentication with an HttpOnly session cookie."""
import hashlib
import secrets

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import settings


SESSION_COOKIE = "evalscope_session"
PUBLIC_PATHS = {
    "/",
    "/health",
    "/docs",
    "/docs/oauth2-redirect",
    "/openapi.json",
    "/redoc",
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/status",
}


def auth_enabled() -> bool:
    return bool(settings.API_AUTH_TOKEN)


def _session_digest(token: str) -> str:
    return hashlib.sha256(f"evalscope-session:{token}".encode()).hexdigest()


def request_is_authenticated(request: Request) -> bool:
    if not auth_enabled():
        return True

    authorization = request.headers.get("authorization", "")
    if authorization.startswith("Bearer "):
        supplied = authorization.removeprefix("Bearer ").strip()
        if supplied and secrets.compare_digest(supplied, settings.API_AUTH_TOKEN):
            return True

    cookie = request.cookies.get(SESSION_COOKIE, "")
    expected = _session_digest(settings.API_AUTH_TOKEN)
    return bool(cookie) and secrets.compare_digest(cookie, expected)


class ApiAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if (
            request.method == "OPTIONS"
            or request.url.path in PUBLIC_PATHS
            or not request.url.path.startswith("/api/")
            or request_is_authenticated(request)
        ):
            return await call_next(request)
        return Response(
            content='{"detail":"未认证或会话已过期"}',
            status_code=status.HTTP_401_UNAUTHORIZED,
            media_type="application/json",
        )


class LoginRequest(BaseModel):
    token: str


router = APIRouter()


@router.get("/status")
async def auth_status(request: Request):
    return {
        "required": auth_enabled(),
        "authenticated": request_is_authenticated(request),
    }


@router.post("/login")
async def login(payload: LoginRequest, response: Response):
    if not auth_enabled():
        return {"authenticated": True, "required": False}
    if not secrets.compare_digest(payload.token, settings.API_AUTH_TOKEN):
        raise HTTPException(status_code=401, detail="访问令牌无效")

    response.set_cookie(
        SESSION_COOKIE,
        _session_digest(settings.API_AUTH_TOKEN),
        httponly=True,
        secure=settings.SESSION_COOKIE_SECURE,
        samesite="strict",
        max_age=settings.SESSION_MAX_AGE_SECONDS,
        path="/",
    )
    return {"authenticated": True, "required": True}


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"authenticated": False, "required": auth_enabled()}
