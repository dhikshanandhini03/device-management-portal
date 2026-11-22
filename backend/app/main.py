import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.api.routes import (
    alerts,
    analytics,
    applications,
    audit,
    auth,
    commands,
    dashboard,
    devices,
    firmware,
    gateway,
    monitoring,
    search,
    users,
)
from app.api.routes import settings as settings_routes
from app.core.config import settings
from app.core.database import engine
from app.core.logging import configure_logging
from app.workers.background import run_worker

configure_logging()
log = logging.getLogger("app")


@asynccontextmanager
async def lifespan(_: FastAPI):
    stop = asyncio.Event()
    task = asyncio.create_task(run_worker(stop))
    log.info("%s backend started (%s)", settings.app_name, settings.environment)
    yield
    stop.set()
    await task


app = FastAPI(
    title="BELL STB Device Management API",
    version="1.0.0",
    description=(
        "REST API for the BELL STB Device Management portal. Device data is produced by a simulator; "
        "this is a portfolio/learning system and not an official Bell production platform."
    ),
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    return response


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    log.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.get("/api/health", tags=["Health"])
def health():
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    return {"status": "ok", "service": "backend"}


for module in (auth, dashboard, devices, commands, firmware, applications, monitoring, alerts, analytics, users, audit,
               settings_routes, search, gateway):
    app.include_router(module.router)
