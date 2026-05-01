from contextlib import asynccontextmanager
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from api.db.connection import THUMBNAILS_DIR, initialize_database
from api.routes.health import router as health_router
from api.routes.map import router as map_router
from api.routes.photos import router as photos_router
from api.routes.thumbnails import router as thumbnails_router
from api.routes.timeline import router as timeline_router
from api.routes.visits import router as visits_router


STATIC_DIR = Path(os.environ.get("PHOTOVIEWER_STATIC_DIR", "/app/static"))
INDEX_HTML = STATIC_DIR / "index.html"


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database()
    yield


app = FastAPI(title="Photoviewer API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(health_router)
app.include_router(timeline_router)
app.include_router(photos_router)
app.include_router(thumbnails_router)
app.include_router(map_router)
app.include_router(visits_router)
app.mount("/thumbnails", StaticFiles(directory=THUMBNAILS_DIR), name="thumbnails")

if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")


def frontend_index_response(status_code: int = 200) -> FileResponse:
    if not INDEX_HTML.exists():
        raise HTTPException(status_code=404, detail="Frontend build not found.")

    return FileResponse(INDEX_HTML, status_code=status_code)


@app.get("/", include_in_schema=False)
def serve_frontend_index() -> FileResponse:
    return frontend_index_response()


@app.get("/{full_path:path}", include_in_schema=False)
def serve_frontend_fallback(full_path: str) -> FileResponse:
    if full_path.startswith(("health", "timeline", "photos", "map", "visits", "thumbnails")):
        return frontend_index_response(status_code=404)

    return frontend_index_response()
