import asyncio
import contextlib
import logging
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.openapi.utils import get_openapi
from fastapi.responses import FileResponse, JSONResponse, Response
from redis.exceptions import RedisError
from sqlalchemy import select, text
from starlette.datastructures import UploadFile
from starlette.exceptions import HTTPException
from starlette.types import ASGIApp, Receive, Scope, Send

from . import anthropic, auth, dashboard
from .auth import CurrentUser, GatewayPrincipal, Principal
from .config import Settings
from .db import Base, create_database
from .discovery import monitor
from .errors import fail
from .models import Provider, RegistryModel
from .routing import Execution
from .schemas import (
    ChatRequest,
    EmbeddingRequest,
    GatewayRequest,
    ImageRequest,
    ResponseRequest,
    SpeechRequest,
)
from .security import Vault, secure_transport, token_hash
from .state import SharedState

logger = logging.getLogger("gateway")


class BodyLimit:
    def __init__(self, app: ASGIApp, maximum: int = 26_214_400):
        self.app, self.maximum = app, maximum

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] in ("GET", "HEAD", "OPTIONS"):
            await self.app(scope, receive, send)
            return
        chunks: list[bytes] = []
        total = 0
        try:
            async with asyncio.timeout(30):
                while True:
                    message = await receive()
                    if message["type"] == "http.disconnect":
                        return
                    chunk = message.get("body", b"")
                    total += len(chunk)
                    maximum = scope["app"].state.settings.max_request_bytes
                    if total > maximum:
                        await JSONResponse(
                            {
                                "error": {
                                    "message": "Request body is too large.",
                                    "type": "gateway_error",
                                    "code": "request_too_large",
                                }
                            },
                            413,
                        )(scope, receive, send)
                        return
                    chunks.append(chunk)
                    if not message.get("more_body", False):
                        break
        except TimeoutError:
            await JSONResponse(
                {"error": {"message": "Request body timed out.", "code": "request_timeout"}}, 408
            )(scope, receive, send)
            return
        sent = False

        async def replay() -> Any:
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": b"".join(chunks), "more_body": False}
            return await receive()

        await self.app(scope, replay, send)


def create_app(
    settings: Settings | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
    background: bool = True,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> Any:
        config = settings or Settings()
        app.state.settings = config
        app.state.db = create_database(config.database_url)
        app.state.vault = Vault(config.encryption_keys)
        app.state.shared = SharedState(config.redis_url)
        app.state.http = httpx.AsyncClient(
            transport=transport or secure_transport(config.private_upstream_hosts),
            timeout=httpx.Timeout(config.upstream_timeout_seconds, connect=10),
            follow_redirects=False,
            trust_env=False,
        )
        engine = app.state.db.kw["bind"]
        if config.environment != "production":
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        if app.state.shared.redis:
            await app.state.shared.redis.ping()
        task = asyncio.create_task(monitor(app.state)) if background else None
        try:
            yield
        finally:
            if task:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
            await app.state.http.aclose()
            await app.state.shared.close()
            await engine.dispose()

    app = FastAPI(
        title="Universal AI Gateway",
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        redoc_url=None,
    )
    app.add_middleware(BodyLimit)

    @app.middleware("http")
    async def protections(request: Request, call_next: Any) -> Response:
        request.state.request_id = str(uuid.uuid4())
        path = request.url.path
        if path.startswith("/api/") and request.method not in ("GET", "HEAD", "OPTIONS"):
            origin = request.headers.get("origin", "")
            if origin not in request.app.state.settings.allowed_origins:
                return JSONResponse(
                    {"error": {"message": "Origin is not allowed.", "code": "origin_forbidden"}},
                    403,
                )
        try:
            if path.startswith("/api/auth/") and request.method == "POST":
                # Do not trust client-supplied forwarding headers. Configure Uvicorn trusted proxies explicitly.
                address = request.client.host if request.client else "unknown"
                await request.app.state.shared.rate_limit("auth:" + token_hash(address), 10)
            response = await call_next(request)
        except RedisError:
            response = JSONResponse(
                {
                    "error": {
                        "message": "Gateway state is temporarily unavailable.",
                        "code": "state_unavailable",
                    }
                },
                503,
            )
        except HTTPException as exc:
            response = JSONResponse({"error": exc.detail}, exc.status_code, headers=exc.headers)
        except Exception:
            logger.error("Request failed; request_id=%s", request.state.request_id)
            response = JSONResponse(
                {"error": {"message": "Internal gateway error.", "code": "internal_error"}}, 500
            )
        response.headers.update(
            {
                "X-Request-ID": request.state.request_id,
                "X-Content-Type-Options": "nosniff",
                "Referrer-Policy": "no-referrer",
                "X-Frame-Options": "DENY",
                "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
            }
        )
        if path == "/api/docs":
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https://fastapi.tiangolo.com; object-src 'none'; frame-ancestors 'none'"
            )
        if path.startswith(("/api/", "/v1/")):
            response.headers["Cache-Control"] = "no-store"
        if request.app.state.settings.cookie_secure:
            response.headers["Strict-Transport-Security"] = "max-age=31536000"
        return response

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException) -> JSONResponse:
        detail = (
            exc.detail
            if isinstance(exc.detail, dict)
            else {"message": str(exc.detail), "type": "gateway_error", "code": "request_error"}
        )
        return JSONResponse({"error": detail}, exc.status_code, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        # Pydantic error inputs can contain passwords/keys. Never serialize them.
        fields = [str(e["loc"][-1]) for e in exc.errors()][:10]
        return JSONResponse(
            {
                "error": {
                    "message": "Invalid request fields: " + ", ".join(fields),
                    "type": "invalid_request_error",
                    "code": "validation_error",
                }
            },
            422,
        )

    app.include_router(auth.router)
    app.include_router(dashboard.router)
    app.include_router(anthropic.router)

    @app.get("/health/live", tags=["Health"])
    async def live() -> dict:
        return {"status": "ok"}

    @app.get("/health/ready", tags=["Health"])
    async def ready(request: Request) -> JSONResponse:
        try:
            async with request.app.state.db() as db:
                await db.execute(text("SELECT 1"))
            if request.app.state.shared.redis:
                await request.app.state.shared.redis.ping()
        except Exception:
            return JSONResponse({"status": "unavailable"}, 503)
        return JSONResponse({"status": "ready"})

    @app.get("/v1/models", tags=["OpenAI compatible"])
    async def list_models(request: Request, principal: GatewayPrincipal) -> dict:
        async with request.app.state.db() as db:
            rows = (
                await db.execute(
                    select(Provider, RegistryModel)
                    .join(RegistryModel)
                    .where(
                        Provider.user_id == principal.user_id,
                        Provider.enabled.is_(True),
                        RegistryModel.available.is_(True),
                    )
                )
            ).all()
        return {
            "object": "list",
            "data": [
                {
                    "id": p.id + "::" + m.model_id,
                    "object": "model",
                    "created": int(m.updated_at),
                    "owned_by": p.kind,
                    "native_id": m.model_id,
                    "provider": p.kind,
                    "capabilities": m.capabilities,
                    "context_window": m.context_window,
                }
                for p, m in rows
            ],
        }

    @app.post("/v1/chat/completions", tags=["OpenAI compatible"])
    async def chat(body: ChatRequest, request: Request, principal: GatewayPrincipal) -> Response:
        return await Execution(request, principal, body, "chat/completions").run()

    @app.post("/v1/embeddings", tags=["OpenAI compatible"])
    async def embeddings(
        body: EmbeddingRequest, request: Request, principal: GatewayPrincipal
    ) -> Response:
        return await Execution(request, principal, body, "embeddings").run()

    @app.post("/v1/images/generations", tags=["OpenAI compatible"])
    async def images(body: ImageRequest, request: Request, principal: GatewayPrincipal) -> Response:
        return await Execution(request, principal, body, "images/generations").run()

    @app.post("/v1/audio/speech", tags=["OpenAI compatible"])
    async def speech(
        body: SpeechRequest, request: Request, principal: GatewayPrincipal
    ) -> Response:
        return await Execution(request, principal, body, "audio/speech").run()

    @app.post("/v1/responses", tags=["OpenAI compatible"])
    async def responses(
        body: ResponseRequest, request: Request, principal: GatewayPrincipal
    ) -> Response:
        return await Execution(request, principal, body, "responses").run()

    @app.post("/v1/audio/transcriptions", tags=["OpenAI compatible"])
    async def transcriptions(request: Request, principal: GatewayPrincipal) -> Response:
        async with request.form(max_files=1, max_fields=30) as form:
            upload = form.get("file")
            if not isinstance(upload, UploadFile):
                raise fail(422, "A multipart audio file is required.")
            data = {k: str(v) for k, v in form.items() if k != "file"}
            if data.get("stream") == "true":
                raise fail(400, "Streaming transcription is not supported in v1.")
            body = GatewayRequest.model_validate(data)
            # Names are not logged. Buffer is bounded by BodyLimit and replayed for fallback.
            files = {
                "file": (
                    Path(upload.filename or "audio.wav").name,
                    await upload.read(),
                    upload.content_type or "application/octet-stream",
                )
            }
            return await Execution(request, principal, body, "audio/transcriptions").run(files)

    @app.post("/api/playground", tags=["Dashboard"])
    async def playground(body: ChatRequest, request: Request, user: CurrentUser) -> Response:
        await request.app.state.shared.rate_limit(
            "user:" + user.id, request.app.state.settings.requests_per_minute
        )
        return await Execution(request, Principal(user.id), body, "chat/completions").run()

    @app.get("/{path:path}", include_in_schema=False)
    async def frontend(path: str, request: Request) -> FileResponse:
        if path.startswith(("api/", "v1/", "health/")):
            raise fail(404, "Endpoint not found.")
        root = request.app.state.settings.static_path
        target = (root / path).resolve()
        if not target.is_relative_to(root):
            raise fail(404, "Not found.")
        if target.is_dir():
            target = target / "index.html"
        if not target.is_file():
            raise fail(404, "Dashboard not built. Run npm run build in frontend.")
        return FileResponse(target)

    def schema() -> dict[str, Any]:
        if app.openapi_schema:
            return app.openapi_schema
        spec = get_openapi(title=app.title, version=app.version, routes=app.routes)
        spec.setdefault("components", {})["securitySchemes"] = {
            "GatewayKey": {"type": "http", "scheme": "bearer", "bearerFormat": "gw_..."},
            "MessagesKey": {"type": "apiKey", "in": "header", "name": "x-api-key"},
            "DashboardSession": {"type": "apiKey", "in": "cookie", "name": "gw_session"},
        }
        for path, operations in spec["paths"].items():
            for method, operation in operations.items():
                if method not in ("get", "post", "put", "patch", "delete"):
                    continue
                if path.startswith("/v1/"):
                    operation["security"] = [{"GatewayKey": []}]
                    if path.startswith("/v1/messages"):
                        operation["security"].append({"MessagesKey": []})
                elif path.startswith("/api/") and path not in (
                    "/api/auth/login",
                    "/api/auth/register",
                ):
                    operation["security"] = [{"DashboardSession": []}]
                    if method != "get":
                        operation.setdefault("parameters", []).append(
                            {
                                "name": "X-CSRF-Token",
                                "in": "header",
                                "required": True,
                                "schema": {"type": "string"},
                                "description": "Value of the gw_csrf cookie. Same-origin dashboard mutations only.",
                            }
                        )
        app.openapi_schema = spec
        return spec

    app.openapi = schema  # type: ignore[method-assign]  # FastAPI custom-schema extension point.
    return app


app = create_app()
