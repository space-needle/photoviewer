# Photoviewer MVP Starter Spec

## 1. Product goal

Build an MVP photo viewer that helps users understand **when** photos were taken, including **time gaps**, using a **vertical heat-ribbon timeline**.

The first version focuses on **local photos only**. It extracts photo metadata from local files and renders a density-based timeline. A simple map view is included, but the main differentiator is the timeline.

## 2. MVP outcome

A user can point the app at a local photo folder and:

* ingest photo metadata from local images
* see a **vertical, gap-aware heat-ribbon timeline**
* zoom between coarse and fine time resolutions
* click a timeline segment to inspect the underlying photos
* see the same photo set on a basic map view

## 3. Non-goals for MVP

Do not include these yet:

* cloud provider ingestion
* photo upload/storage in app backend
* editing metadata
* trip detection
* inferred GPS for missing locations
* fancy album/story generation
* combined synchronized map+timeline interactions beyond simple filtering/highlighting
* authentication or multi-user support

## 4. Primary design choice

### Main UI pattern: Option D — Vertical density ribbon timeline

The main screen uses a **vertical scrollable timeline** where:

* vertical position represents time
* empty space represents inactivity / time gaps
* ribbon intensity represents photo count within the current time bucket
* zoom level changes bucket granularity

This is the primary MVP visualization.

## 5. Core user stories

### Story 1 — Ingest local photo library

As a user, I can select a local folder so the app extracts timestamp and GPS metadata from image files.

### Story 2 — See photo density over time

As a user, I can scroll a vertical timeline and quickly spot active periods, sparse periods, and large gaps.

### Story 3 — Zoom timeline granularity

As a user, I can zoom the timeline so each bucket represents year/month/day/hour depending on scale.

### Story 4 — Inspect photos behind a time bucket

As a user, I can tap/click a ribbon segment and see the photos that belong to that bucket.

### Story 5 — View photo locations on a map

As a user, I can see photo points/clusters on a map using GPS metadata.

## 6. Information architecture

### Main screen

Two-tab layout is enough for MVP:

* **Timeline**
* **Map**

Default tab: **Timeline**

### Timeline screen structure

* top bar

  * app title
  * import folder button
  * zoom controls
  * optional date range summary
* main body

  * vertical heat-ribbon timeline
* bottom sheet / side panel

  * selected bucket details
  * photo thumbnail strip or grid

### Map screen structure

* map canvas
* photo points or clusters
* optional date filter summary
* tapping a point/cluster opens related thumbnails

## 7. Timeline UI model

### 7.1 Visual model

Each time bucket becomes one vertical segment in the ribbon.

For each segment:

* segment height is fixed within the current zoom level
* color intensity is based on photo count in that bucket
* spacing between segments reflects time continuity at that zoom level

### 7.2 Ribbon behavior

At a given zoom level:

* **Year zoom**: bucket = month or week
* **Month zoom**: bucket = day
* **Day zoom**: bucket = hour
* **Hour zoom**: bucket = 5-minute or 15-minute intervals (optional, can defer)

Recommended MVP zoom levels:

* overview: 1 bucket = 1 day
* mid zoom: 1 bucket = 6 hours
* detail zoom: 1 bucket = 1 hour

### 7.3 Gap-aware behavior

The timeline must preserve real temporal gaps.

Examples:

* a month with no photos should visibly occupy more vertical space than a one-day gap
* consecutive active days should appear as dense adjacent ribbon areas
* long inactive periods should be visually obvious, not collapsed away

To keep very large gaps usable on mobile, use:

* **soft compression for extremely large empty spans**
* plus a visible gap annotation such as `14d gap` or `3mo gap`

### 7.4 Color encoding

Single-hue intensity scale for MVP.

Example:

* 0 photos: transparent / background
* 1–2 photos: very light blue
* 3–10 photos: light-medium blue
* 11–30 photos: medium blue
* 31+ photos: dark blue

Use quantized buckets first, not continuous gradients.

### 7.5 Interaction model

#### Scroll

* vertical scroll moves through time

#### Zoom

* pinch zoom on mobile
* +/- buttons on desktop/web
* zoom changes bucket size and aggregation granularity

#### Tap / click

* selecting a ribbon segment opens bucket details
* show:

  * bucket time range
  * photo count
  * thumbnail grid

#### Hover (desktop only)

* show tooltip with count and date range

## 8. Photo detail interaction

When a timeline bucket is selected:

* open bottom sheet on mobile
* open side panel on desktop

Display:

* date/time range
* photo count
* thumbnails

Photo open flow:

1. tap bucket
2. see thumbnails
3. tap thumbnail
4. open full-size image from local file path

## 9. Map UI model

MVP map behavior:

* show photos with valid GPS coordinates
* use clustering at wider zoom levels
* selecting a point/cluster opens thumbnails

MVP map does **not** need deep time integration yet.
It is a separate exploration surface using the same metadata store.

## 10. Data model

### Photo

* id
* source_type (`local`)
* file_path
* file_name
* timestamp_original
* timestamp_normalized
* timezone_offset if known
* latitude nullable
* longitude nullable
* width nullable
* height nullable
* thumbnail_path nullable
* checksum or file fingerprint optional

### TimelineBucket (derived, query result)

* bucket_start
* bucket_end
* zoom_level
* photo_count
* representative_photo_ids

## 11. Ingestion scope

### Input

Local folder containing image files.

### Supported formats for MVP

* jpg / jpeg
* heic if easy
* png only if metadata is available

### Metadata extraction goals

Required:

* capture timestamp
* capture GPS coordinates

Optional:

* dimensions
* camera model

### Ingestion rules

* recurse folders
* skip unsupported files
* skip duplicates if fingerprint matches
* persist extraction result locally
* allow re-scan / incremental ingestion later

## 12. Storage model

Use local SQLite for MVP.

Store:

* photo metadata
* ingestion status
* cached thumbnail paths

Do not store original photos in the app database.
Keep file paths only.

## 13. Thumbnail strategy

For MVP:

* generate small local thumbnails on first access or during ingestion
* keep them in app cache folder
* use thumbnails in bucket detail panel
* full image loads only when thumbnail is selected

## 14. Recommended MVP screens

### Screen 1 — Empty state

* import local folder CTA
* short explanation of timeline concept

### Screen 2 — Timeline overview

* vertical density ribbon
* scroll + zoom
* bucket selection

### Screen 3 — Bucket detail

* bottom sheet / panel with thumbnail grid

### Screen 4 — Full photo viewer

* image centered
* swipe left/right within selected bucket optional

### Screen 5 — Map view

* clustered dots
* tap cluster to inspect photos

## 15. Functional requirements

### Must-have

* local folder import
* metadata extraction for timestamp/GPS
* SQLite persistence
* vertical density ribbon timeline
* zoom between at least 3 time granularities
* bucket selection
* thumbnail preview grid
* full image open
* basic map view with clusters

### Nice-to-have if easy

* date jump control
* gap labels for long inactive spans
* simple filters: has GPS / no GPS
* rescan folder button

## 16. Success criteria for MVP

The MVP is successful if a user can:

* import a personal photo folder
* immediately see dense periods vs long gaps
* find a specific cluster of memories faster than in a plain chronological grid
* open pictures from a chosen time bucket
* inspect geographically tagged photos on a map

## 17. Suggested implementation slices

### Slice 1

* ingest local photos
* store metadata in SQLite
* verify timestamp/GPS extraction

### Slice 2

* build timeline aggregation API / query layer
* return bucket counts for a selected zoom level and date range

### Slice 3

* render vertical density ribbon timeline
* implement scroll and zoom

### Slice 4

* bucket selection + thumbnail panel
* full image viewer

### Slice 5

* basic map tab with photo clusters

## 18. Open design decisions to keep simple for now

* how aggressively to compress very large time gaps
* exact bucket thresholds for color scale
* whether to use daily buckets or weekly buckets at far zoom
* whether bucket width should stay fixed or subtly widen with density

Recommended default:

* fixed ribbon width
* color-only density encoding
* daily overview
* large-gap annotation after 7+ days

## 19. Future versions after MVP

* combined synchronized map + timeline
* cloud ingestion from OneDrive / Google Photos
* trip / visit detection
* inferred locations for missing GPS
* semantic event grouping
* multi-user support

## 20. One-sentence MVP summary

A local-first photo metadata explorer with a **vertical, gap-aware, zoomable heat-ribbon timeline** and a basic map view.

## 21. Codex-ready implementation spec

### 21.1 Recommended repo shape

Use a small monorepo with a clear split between UI, ingestion, and shared types.

```text
photoviewer/
  README.md
  docs/
    mvp-spec.md
    codex-tasks.md
  apps/
    web/
      src/
        app/
        components/
        features/
        lib/
      package.json
      vite.config.ts
    api/
      src/
        main.py
        routes/
        services/
        db/
        models/
        schemas/
      pyproject.toml
  packages/
    shared/
      src/
        types.ts
        buckets.ts
        constants.ts
  scripts/
    seed_sample_data.py
    ingest_local_folder.py
  data/
    photoviewer.db
  .gitignore
```

Recommended stack:

* **Web UI**: React + TypeScript + Vite
* **Map**: Leaflet for MVP simplicity
* **Charts / rendering**: custom div/canvas-based ribbon timeline
* **API**: FastAPI
* **DB**: SQLite
* **Ingestion**: Python

This repo layout works well with Codex because it supports parallel tasks across frontend, backend, and ingestion while keeping file boundaries obvious. Codex is designed to work with local folders/repos and supports project-based parallel threads and Git/worktree workflows. ([developers.openai.com](https://developers.openai.com/codex/app?utm_source=chatgpt.com))

### 21.2 SQLite schema

Start with a minimal schema.

#### photos

```sql
CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  file_path TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  timestamp_original TEXT,
  timestamp_normalized TEXT NOT NULL,
  timezone_offset TEXT,
  latitude REAL,
  longitude REAL,
  width INTEGER,
  height INTEGER,
  thumbnail_path TEXT,
  fingerprint TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_photos_timestamp ON photos(timestamp_normalized);
CREATE INDEX IF NOT EXISTS idx_photos_lat_lon ON photos(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_photos_fingerprint ON photos(fingerprint);
```

#### ingestions

```sql
CREATE TABLE IF NOT EXISTS ingestions (
  id TEXT PRIMARY KEY,
  root_path TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  scanned_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);
```

#### ingestion_errors

```sql
CREATE TABLE IF NOT EXISTS ingestion_errors (
  id TEXT PRIMARY KEY,
  ingestion_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  error_code TEXT NOT NULL,
  error_message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (ingestion_id) REFERENCES ingestions(id)
);
```

### 21.3 Timeline aggregation contract

The UI should not compute buckets directly from raw photos at first. Put that logic in the API.

#### request

`GET /timeline/buckets`

Query params:

* `start`: ISO timestamp
* `end`: ISO timestamp
* `zoom`: `overview | mid | detail`
* `include_empty`: boolean, default true

#### zoom mapping

* `overview` = 1 day buckets
* `mid` = 6 hour buckets
* `detail` = 1 hour buckets

#### response

```json
{
  "start": "2024-01-01T00:00:00Z",
  "end": "2024-03-01T00:00:00Z",
  "zoom": "overview",
  "bucket_size": "1d",
  "buckets": [
    {
      "bucket_start": "2024-01-01T00:00:00Z",
      "bucket_end": "2024-01-02T00:00:00Z",
      "photo_count": 12,
      "color_level": 2,
      "has_gap_label": false
    },
    {
      "bucket_start": "2024-01-02T00:00:00Z",
      "bucket_end": "2024-01-03T00:00:00Z",
      "photo_count": 0,
      "color_level": 0,
      "has_gap_label": false
    }
  ]
}
```

#### gap label rule for MVP

* if 7 or more consecutive empty daily buckets exist in `overview`, mark the first rendered compressed segment with a gap label
* if 24 or more consecutive empty hourly buckets exist in `detail`, mark a gap label

### 21.4 Photo lookup contract

#### list photos for one bucket

`GET /photos`

Query params:

* `bucket_start`
* `bucket_end`
* `limit`
* `offset`

Response:

```json
{
  "total": 23,
  "items": [
    {
      "id": "...",
      "file_path": "...",
      "thumbnail_path": "...",
      "timestamp_normalized": "2024-01-28T15:10:00Z",
      "latitude": 33.8,
      "longitude": -118.1
    }
  ]
}
```

#### single photo detail

`GET /photos/{id}`

Returns metadata plus full local path reference.

### 21.5 Map contract

`GET /map/points`

Query params:

* `start`
* `end`
* `bounds` optional
* `cluster` boolean

Response:

```json
{
  "items": [
    {
      "type": "photo",
      "id": "...",
      "lat": 34.05,
      "lon": -118.24,
      "thumbnail_path": "...",
      "timestamp_normalized": "2024-01-28T15:10:00Z"
    }
  ]
}
```

For MVP, server-side clustering is optional. Client-side clustering in Leaflet is acceptable.

### 21.6 Ingestion pipeline contract

#### command

```bash
python scripts/ingest_local_folder.py --root /path/to/photos
```

#### responsibilities

* recursively scan files
* accept jpg/jpeg by default
* optionally support heic if dependency setup is straightforward
* extract EXIF timestamp and GPS
* normalize timestamp to ISO string
* generate deterministic `id`
* optionally compute fingerprint from file path + size + mtime for MVP
* insert or update database row
* record ingestion summary and errors

#### metadata extraction precedence

1. `DateTimeOriginal`
2. fallback to other EXIF timestamp fields
3. fallback to file modified time only if no EXIF time exists, and mark as derived later if desired

#### GPS extraction

* read EXIF GPS if present
* convert to decimal lat/lon
* if absent, keep null

### 21.7 Thumbnail generation contract

Use a background-safe helper.

#### rule

* generate thumbnail on demand the first time a bucket is opened
* cache under app cache directory
* max dimension for MVP: 320px

#### endpoint

`POST /thumbnails/ensure`

Body:

```json
{ "photo_ids": ["id1", "id2"] }
```

Returns updated thumbnail paths.

### 21.8 Frontend component tree

#### app shell

* `App`
* `TopNav`
* `TabBar`

#### timeline tab

* `TimelinePage`
* `TimelineToolbar`
* `HeatRibbonTimeline`
* `GapLabel`
* `BucketTooltip` desktop only
* `BucketDetailSheet`
* `ThumbnailGrid`
* `PhotoViewerModal`

#### map tab

* `MapPage`
* `PhotoMap`
* `MapClusterPopup`
* `ThumbnailGrid`
* `PhotoViewerModal`

### 21.9 Frontend state model

Use a simple state store first.

#### app state

* selected tab
* selected zoom
* visible timeline range
* selected bucket
* selected photo
* import status

#### data fetching state

Prefer TanStack Query or equivalent.

Queries:

* timeline buckets by `(start, end, zoom)`
* photos by selected bucket
* map points by current date range

### 21.10 Timeline rendering model

Use a scrollable vertical container.

#### rendering rules

* each bucket renders as one row
* row height depends on zoom level

  * overview: 6px
  * mid: 10px
  * detail: 14px
* color level maps from quantized count
* empty buckets render as background rows
* compressed empty ranges render one placeholder row plus label

#### initial color quantization

For overview/day buckets:

* 0 => 0
* 1 to 2 => 1
* 3 to 10 => 2
* 11 to 30 => 3
* 31+ => 4

For hour buckets, use a lower threshold table if needed.

### 21.11 Mobile interaction model

* primary gesture: vertical scroll
* pinch: zoom timeline
* tap ribbon row: open bottom sheet
* tap thumbnail: full-screen modal
* swipe down modal: close

### 21.12 Desktop interaction model

* mouse wheel or buttons for zoom
* hover bucket tooltip
* click bucket opens right-side panel instead of bottom sheet

### 21.13 API route list

#### ingestion

* `POST /ingestions/import-local`
* `GET /ingestions/{id}`

#### timeline

* `GET /timeline/buckets`

#### photos

* `GET /photos`
* `GET /photos/{id}`

#### thumbnails

* `POST /thumbnails/ensure`

#### map

* `GET /map/points`

#### health

* `GET /health`

### 21.14 Suggested build order for Codex

#### milestone 1 — backend foundation

* create FastAPI app
* create SQLite connection + migrations/bootstrap
* create `photos`, `ingestions`, `ingestion_errors` tables
* implement health route

#### milestone 2 — local ingestion

* implement local folder scan script
* extract EXIF timestamp and GPS
* persist rows to DB
* add ingestion summary logging

#### milestone 3 — timeline backend

* implement bucket aggregation service
* add `/timeline/buckets`
* add quantized color level logic
* add compressed gap labeling

#### milestone 4 — basic web shell

* create React app shell
* add tabs for Timeline and Map
* add import action placeholder

#### milestone 5 — heat ribbon timeline UI

* render fetched buckets as vertical ribbon rows
* add zoom controls
* add bucket selection

#### milestone 6 — bucket detail + thumbnails

* add `/photos`
* build bottom sheet / side panel
* add thumbnail generation on demand
* build photo modal

#### milestone 7 — map tab

* build Leaflet map
* render photo markers / clusters
* add cluster popup with thumbnails

### 21.15 Codex task prompts

Use short, bounded tasks instead of one giant ask.

#### Task A — initialize backend

"Set up a FastAPI app under `apps/api` for the photoviewer MVP. Add a SQLite connection module, table bootstrap for `photos`, `ingestions`, and `ingestion_errors`, and a `/health` route. Keep the code small and typed."

#### Task B — implement ingestion

"Implement `scripts/ingest_local_folder.py` to recursively scan a folder for jpg/jpeg files, extract EXIF timestamp and GPS, normalize the timestamp, and upsert rows into the `photos` table. Also create an ingestion summary record."

#### Task C — implement timeline buckets

"Add a `/timeline/buckets` route in the FastAPI app. It should accept `start`, `end`, and `zoom` and return bucketed photo counts with quantized `color_level` values for `overview`, `mid`, and `detail` zooms. Include support for compressed empty gap labeling in a minimal MVP-friendly way."

#### Task D — timeline UI

"Build a React Timeline page under `apps/web` that fetches `/timeline/buckets` and renders a vertical heat-ribbon timeline. Add zoom controls for overview/mid/detail and allow clicking a bucket to select it. Use a clean mobile-first layout."

#### Task E — bucket details

"Add a bucket detail bottom sheet for mobile and side panel for desktop. When a bucket is selected, fetch `/photos` for that bucket and render a thumbnail grid. Clicking a thumbnail should open a simple full-screen photo modal."

#### Task F — map tab

"Build a basic Leaflet map tab that loads GPS-tagged photos from `/map/points`, clusters markers, and shows thumbnails in a popup. Keep time filtering minimal and driven by the current selected timeline range."

### 21.16 Acceptance tests

#### ingestion

* importing a folder with at least 100 test photos inserts metadata without crashing
* photos with missing GPS still import
* duplicate rescans do not create duplicate rows

#### timeline

* overview returns daily buckets across requested range
* empty periods appear in results
* long gaps can be represented with labels/compression metadata
* selected bucket returns correct photo count

#### UI

* user can switch tabs
* user can zoom between 3 levels
* user can tap a bucket and see thumbnails
* user can open a full photo

### 21.17 Sample seed dataset suggestion

For faster UI work, create a seed script that generates synthetic photo metadata:

* one dense 5-day trip
* one sparse month
* one 45-day gap
* another dense weekend
* mixed GPS / no-GPS records

This lets you validate the gap-aware ribbon without waiting for real ingestion.

### 21.18 Risks to call out in the repo README

* EXIF timestamps may be wrong or timezone-naive
* many photos may have no GPS
* HEIC support may vary by environment
* large libraries may eventually need background jobs and virtualization

### 21.19 Definition of done for first Codex pass

The first Codex-delivered slice is done when:

* a local folder can be ingested into SQLite
* the web app can load a vertical density ribbon timeline from the API
* selecting a bucket shows thumbnails
* the map tab shows GPS-tagged photos

