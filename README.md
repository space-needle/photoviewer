# Photoviewer

Photoviewer is a local-first photo metadata viewer. It ingests local photo metadata into SQLite, exposes a FastAPI backend, and supports timeline/map exploration of photos, visits, thumbnails, and local files.

The project is intentionally simple for now: one API service, local SQLite storage, local photo folders, and no hosted frontend container yet.

## Current Deployment Status

- Platform: Oracle Cloud Infrastructure VM
- OS: Ubuntu 22.04
- Runtime: Docker + Docker Compose
- API port: `8000`
- Deployment style: single VM, single Docker Compose service
- Database: SQLite file under `./data`
- Original photos: local folder, not committed to git
- Thumbnails: generated cache, not committed to git

## Local Development Notes

Backend code lives under `apps/api`. The Docker setup builds and runs the FastAPI API from that app.

Useful local paths:

- `apps/api/src`: FastAPI source
- `scripts/`: ingestion and visit-detection scripts
- `data/`: SQLite database and local app data
- `photos/`: original photo files, local only
- `thumbnails/`: generated thumbnail cache

Do not commit private/generated data. These should be gitignored:

- `data/`
- `photos/`
- `thumbnails/`
- `.env`
- `node_modules/`

## OCI VM Deployment

On a fresh Ubuntu 22.04 VM with Docker and Docker Compose installed:

```bash
git clone <your-repo-url> photoviewer
cd photoviewer
mkdir -p data photos thumbnails
docker compose up -d --build
```

Check the API:

```bash
curl http://localhost:8000/health
```

If OCI firewall/security lists are configured to allow inbound TCP `8000`, the API is available at:

```text
http://<vm-public-ip>:8000
```

## Common Commands

Start or rebuild:

```bash
docker compose up -d --build
```

View logs:

```bash
docker compose logs -f
```

Restart:

```bash
docker compose restart
```

Stop:

```bash
docker compose down
```

Update deployment:

```bash
git pull && docker compose up -d --build
```

## Directory And Data Notes

SQLite data is stored on the VM under:

```text
./data
```

Original photos should live under:

```text
./photos
```

Generated thumbnails should live under:

```text
./thumbnails
```

These folders are mounted into the API container by `docker-compose.yml`. They are local runtime data, not source code, and should be backed up separately from git.
