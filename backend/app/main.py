from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.frontend import register_frontend
from app.models import ApiError
from app.routers.auth import router as auth_router
from app.routers.canvas import router as canvas_router
from app.routers.collaboration import Hub, router as collaboration_router
from app.routers.join import router as join_router
from app.routers.sessions import router as sessions_router
from app.routers.sharing import router as sharing_router
from app.store import DEMO_EMAIL, DEMO_PASSWORD, Store

store = Store()
hub = Hub()

app = FastAPI(
    title="Lattice interview API",
    version="1.0.0",
    description=(
        "Lattice API. Protected routes expect Authorization: Bearer. "
        f"Seeded interviewer: {DEMO_EMAIL} / {DEMO_PASSWORD}. "
        "Set DATABASE_URL to choose the database; SQLite is the default."
    ),
)
app.state.store = store
app.state.hub = hub
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Access-Token"],
)
for item in (auth_router, sessions_router, sharing_router, canvas_router, join_router, collaboration_router):
    app.include_router(item, prefix="/v1")


@app.exception_handler(ApiError)
def api_error(_request: Request, error: ApiError) -> JSONResponse:
    return JSONResponse(status_code=error.status, content={"code": error.code, "message": error.message})


@app.exception_handler(RequestValidationError)
def validation_error(_request: Request, _error: RequestValidationError) -> JSONResponse:
    return JSONResponse(status_code=400, content={"code": "invalid", "message": "Request body is not valid."})


register_frontend(app)
