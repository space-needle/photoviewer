FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN python -m pip install --no-cache-dir --upgrade pip

COPY apps/api/pyproject.toml /app/apps/api/pyproject.toml
COPY apps/api/src /app/apps/api/src
COPY scripts /app/scripts

RUN python -m pip install --no-cache-dir -e /app/apps/api

EXPOSE 8000

CMD ["uvicorn", "main:app", "--app-dir", "/app/apps/api/src", "--host", "0.0.0.0", "--port", "8000"]
