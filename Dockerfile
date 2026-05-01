FROM node:20-slim AS web-build

WORKDIR /app/apps/web

COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci

COPY apps/web ./
RUN npm run build

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN python -m pip install --no-cache-dir --upgrade pip

COPY apps/api/pyproject.toml /app/apps/api/pyproject.toml
COPY apps/api/src /app/apps/api/src
COPY apps/api/migrations /app/apps/api/migrations
COPY alembic.ini /app/alembic.ini
COPY scripts /app/scripts
COPY --from=web-build /app/apps/web/dist /app/static

RUN python -m pip install --no-cache-dir -e /app/apps/api

EXPOSE 8000

CMD ["uvicorn", "main:app", "--app-dir", "/app/apps/api/src", "--host", "0.0.0.0", "--port", "8000"]
