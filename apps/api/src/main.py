from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from api.db.connection import THUMBNAILS_DIR, initialize_database
from api.routes.health import router as health_router
from api.routes.map import router as map_router
from api.routes.photos import router as photos_router
from api.routes.thumbnails import router as thumbnails_router
from api.routes.timeline import router as timeline_router
from api.routes.visits import router as visits_router


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
