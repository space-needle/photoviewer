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

## Database Migrations

Alembic migrations live under:

```text
apps/api/migrations
```

For a managed MySQL database, set `DATABASE_URL` before running migrations:

```bash
export DATABASE_URL='mysql+pymysql://user:password@host:3306/photoviewer'
```

Run migrations from the repo root:

```bash
alembic upgrade head
```

Or run them inside the API container after rebuilding:

```bash
docker compose exec api alembic upgrade head
```

Ingestion uses the same `DATABASE_URL`, so export it before starting Compose:

```bash
export DATABASE_URL='mysql+pymysql://user:password@host:3306/photoviewer'
docker compose up -d --build
docker compose exec api python scripts/ingest_local_folder.py --root /photos
```

## OneDrive Sync

OneDrive sync uses Microsoft Graph device code auth, so it works on the OCI VM without a browser. Set these before starting Compose:

```bash
export MS_CLIENT_ID='<azure-app-client-id>'
export MS_TENANT_ID='common'
export ONEDRIVE_SCOPES='Files.Read offline_access User.Read'
```

Authenticate once and follow the printed device login instructions:

```bash
docker compose exec api python scripts/sync_onedrive.py auth
```

Then sync OneDrive image metadata:

```bash
docker compose exec api python scripts/sync_onedrive.py sync
```

For large libraries, tune progress output and skip noisy folders:

```bash
docker compose exec api python scripts/sync_onedrive.py sync --progress-every 1000 --skip-path-contains /tier2/
```

To process a large library in resumable batches, add `--max-items`. The script finishes the current Graph page, saves a continuation cursor, and the next run resumes from that cursor:

```bash
docker compose exec api python scripts/sync_onedrive.py sync --max-items 100000 --progress-every 1000 --skip-path-contains /tier2/
```

Skip filters can also come from the environment:

```bash
export ONEDRIVE_SKIP_PATH_CONTAINS=/tier2/
```

The MSAL token cache is stored under `/data/msal_token_cache.bin`, backed by the mounted `./data` volume. The first sync uses Microsoft Graph delta; later syncs reuse the saved delta or continuation cursor in `source_accounts.sync_cursor`.

The migrations create:

- `users`
- `source_accounts`
- `photos`
- `ingestions`
- `ingestion_errors`
- `photo_day_counts`
- `visits`
- `photo_visits`

For now the app creates/uses a default development user (`dev-user`) and default local source account (`dev-local-source`). Authentication is intentionally not implemented yet.

SQLite support still exists for local/simple deployments. The current Docker Compose setup stores SQLite data under `./data`; MySQL migrations are for reproducible managed database schema setup.

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

Rebuild timeline daily aggregates after a large ingestion/sync:

```bash
docker compose exec api python scripts/rebuild_timeline_day_counts.py
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
