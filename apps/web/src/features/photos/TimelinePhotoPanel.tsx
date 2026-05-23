import { useEffect, useState } from "react";

import {
  ensureThumbnails,
  getPhotosInBucket,
  getVisitPhotos,
  toApiAssetUrl,
  type PhotoListItem,
  type TimelineBucket,
  type Visit,
} from "../../lib/api";
import { EditableVisitTitle } from "../visits/EditableVisitTitle";

type TimelinePhotoPanelProps = {
  selectedBucket: TimelineBucket | null;
  timelineBuckets: TimelineBucket[];
  activeVisit: Visit | null;
  onOpenPhoto: (photo: PhotoListItem) => void;
  onSelectBucket: (bucket: TimelineBucket) => void;
  onRenameVisit: (visit: Visit) => void;
  onClearSelection?: () => void;
};

type SelectionKind = "visit" | "bucket";

export function TimelinePhotoPanel(props: TimelinePhotoPanelProps) {
  const {
    selectedBucket,
    timelineBuckets,
    activeVisit,
    onOpenPhoto,
    onSelectBucket,
    onRenameVisit,
    onClearSelection,
  } = props;
  const [photos, setPhotos] = useState<PhotoListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectionKind: SelectionKind | null = activeVisit
    ? "visit"
    : selectedBucket
      ? "bucket"
      : null;
  const selectedDayBuckets =
    selectionKind === "bucket" && selectedBucket
      ? getDayBucketsInRange(timelineBuckets, selectedBucket)
      : [];
  const maxSelectedDayCount = Math.max(
    0,
    ...selectedDayBuckets.map((bucket) => bucket.photo_count),
  );

  useEffect(() => {
    let cancelled = false;

    async function loadPhotos() {
      if (!selectionKind) {
        setPhotos([]);
        setTotal(0);
        setError(null);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const response =
          selectionKind === "visit" && activeVisit
            ? await getVisitPhotos({ visitId: activeVisit.id })
            : await getPhotosInBucket({
                bucketStart: selectedBucket?.bucket_start ?? "",
                bucketEnd: selectedBucket?.bucket_end ?? "",
              });
        const ensured = await ensureThumbnails(response.items.map((photo) => photo.id));
        const thumbnailsById = new Map(
          ensured.items.map((item) => [item.id, item.thumbnail_path]),
        );

        if (cancelled) {
          return;
        }

        setTotal(response.total);
        setPhotos(
          response.items.map((photo) => ({
            ...photo,
            thumbnail_path: thumbnailsById.get(photo.id) ?? photo.thumbnail_path,
          })),
        );
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        setPhotos([]);
        setTotal(0);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load photos for this selection.",
        );
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadPhotos();

    return () => {
      cancelled = true;
    };
  }, [activeVisit, selectedBucket, selectionKind]);

  if (!selectionKind) {
    return null;
  }

  return (
    <>
      <section className="selectedRangePanel">
        <div className="selectedRangeHeader">
          <div>
            <p className="sectionLabel">Selected range</p>
            {selectionKind === "visit" && activeVisit ? (
              <h3 className="panelTitle">
                <EditableVisitTitle visit={activeVisit} onRenamed={onRenameVisit} />
              </h3>
            ) : (
              <h3 className="panelTitle">{formatSelectedBucketLabel(selectedBucket)}</h3>
            )}
            <p className="placeholderBody">
              {selectionKind === "visit" && activeVisit
                ? `${activeVisit.start_time} to ${activeVisit.end_time}`
                : `${selectedBucket?.bucket_start} to ${selectedBucket?.bucket_end}`}
            </p>
          </div>
          <div className="selectionActions">
            <span className="statusPill">{total} photos</span>
            {onClearSelection ? (
              <button type="button" className="clearSelectionButton" onClick={onClearSelection}>
                Clear
              </button>
            ) : null}
          </div>
        </div>

        {selectedDayBuckets.length > 1 ? (
          <div className="dayDrillGrid" aria-label="Daily counts in selected range">
            {selectedDayBuckets.map((bucket) => {
              const level = getSelectedRangeDensityLevel(
                bucket.photo_count,
                maxSelectedDayCount,
              );
              const isSelected = isSameBucket(selectedBucket, bucket);

              return (
                <button
                  key={`${bucket.bucket_start}-${bucket.bucket_end}`}
                  type="button"
                  className={
                    isSelected
                      ? `dayDrillCell tenDayLevel${level} selected`
                      : `dayDrillCell tenDayLevel${level}`
                  }
                  title={`${formatSelectedBucketLabel(bucket)}: ${formatPhotoCount(bucket.photo_count)}`}
                  onClick={() => onSelectBucket(bucket)}
                >
                  <span>{formatDayOfMonth(bucket.bucket_start)}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </section>

      <section className="timelinePhotoPanel">
        <div className="detailPanelHeader">
          <div>
            <p className="sectionLabel">
              {selectionKind === "visit" ? "Visit photos" : "Bucket photos"}
            </p>
            <h3 className="panelTitle">
              {selectionKind === "visit" ? "Photos in visit" : "Photos in range"}
            </h3>
          </div>
        </div>

        {isLoading ? (
          <div className="messageCard">
            <p className="placeholderTitle">Loading photos...</p>
            <p className="placeholderBody">Preparing thumbnails for this selection.</p>
          </div>
        ) : null}

        {error ? (
          <div className="messageCard errorCard">
            <p className="placeholderTitle">Could not load photos</p>
            <p className="placeholderBody">{error}</p>
          </div>
        ) : null}

        {!isLoading && !error && photos.length === 0 ? (
          <div className="emptyStateCard">
            <p className="placeholderTitle">
              {selectionKind === "visit"
                ? "No photos found for this visit."
                : "No photos found for this bucket."}
            </p>
            <p className="placeholderBody">Try another dot or visit card.</p>
          </div>
        ) : null}

        {!isLoading && !error && photos.length > 0 ? (
          <div className="thumbnailGrid">
            {photos.map((photo) => (
              <button
                key={photo.id}
                type="button"
                className="thumbnailButton"
                onClick={() => onOpenPhoto(photo)}
              >
                <img
                  className="thumbnailImage"
                  src={
                    toApiAssetUrl(photo.thumbnail_url) ??
                    toApiAssetUrl(photo.thumbnail_path) ??
                    ""
                  }
                  alt={photo.file_name}
                  loading="lazy"
                />
              </button>
            ))}
          </div>
        ) : null}
      </section>
    </>
  );
}

function formatSelectedBucketLabel(bucket: TimelineBucket | null): string {
  if (!bucket) {
    return "Selected range";
  }

  const start = new Date(bucket.bucket_start);
  const end = new Date(bucket.bucket_end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return "Selected range";
  }

  const displayEnd = new Date(end);
  displayEnd.setDate(displayEnd.getDate() - 1);

  if (
    start.getFullYear() === displayEnd.getFullYear() &&
    start.getMonth() === displayEnd.getMonth() &&
    start.getDate() === displayEnd.getDate()
  ) {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(start);
  }

  const month = new Intl.DateTimeFormat(undefined, { month: "short" }).format(start);
  return `${month} ${start.getDate()}-${displayEnd.getDate()}, ${start.getFullYear()}`;
}

function getDayBucketsInRange(
  buckets: TimelineBucket[],
  selectedBucket: TimelineBucket,
): TimelineBucket[] {
  const start = parseDate(selectedBucket.bucket_start);
  const end = parseDate(selectedBucket.bucket_end);
  if (!start || !end) {
    return [];
  }

  const days: TimelineBucket[] = [];
  const cursor = new Date(start);
  const bucketsByDay = new Map(
    buckets.map((bucket) => [bucket.bucket_start.slice(0, 10), bucket]),
  );

  while (cursor < end) {
    const dayStart = formatLocalIsoDate(
      cursor.getFullYear(),
      cursor.getMonth(),
      cursor.getDate(),
    );
    const dayEnd = formatLocalIsoDate(
      cursor.getFullYear(),
      cursor.getMonth(),
      cursor.getDate() + 1,
    );
    const existingBucket = bucketsByDay.get(dayStart.slice(0, 10));

    days.push(
      existingBucket ?? {
        bucket_start: dayStart,
        bucket_end: dayEnd,
        photo_count: 0,
        color_level: 0,
        has_gap_label: false,
        gap_label: null,
      },
    );
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

function getSelectedRangeDensityLevel(photoCount: number, maxVisibleCount: number): number {
  if (photoCount <= 0) {
    return 0;
  }
  if (maxVisibleCount <= 1) {
    return quantizeSelectedRangeColorLevel(photoCount);
  }

  const adaptiveLevel = Math.ceil((photoCount / maxVisibleCount) * 5);
  return Math.max(quantizeSelectedRangeColorLevel(photoCount), adaptiveLevel, 1);
}

function quantizeSelectedRangeColorLevel(photoCount: number): number {
  if (photoCount <= 0) {
    return 0;
  }
  if (photoCount === 1) {
    return 1;
  }
  if (photoCount <= 3) {
    return 2;
  }
  if (photoCount <= 7) {
    return 3;
  }
  if (photoCount <= 15) {
    return 4;
  }
  return 5;
}

function isSameBucket(
  selectedBucket: TimelineBucket | null,
  bucket: TimelineBucket,
): boolean {
  return (
    selectedBucket?.bucket_start === bucket.bucket_start &&
    selectedBucket?.bucket_end === bucket.bucket_end
  );
}

function parseDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatLocalIsoDate(year: number, monthIndex: number, day: number): string {
  const date = new Date(year, monthIndex, day);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getDate()).padStart(2, "0")}T00:00:00`;
}

function formatDayOfMonth(value: string): string {
  const date = parseDate(value);
  return date ? String(date.getDate()) : value.slice(8, 10);
}

function formatPhotoCount(count: number): string {
  return count === 1 ? "1 photo" : `${count} photos`;
}
