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
  activeVisit: Visit | null;
  onOpenPhoto: (photo: PhotoListItem) => void;
  onRenameVisit: (visit: Visit) => void;
  onClearSelection?: () => void;
};

type SelectionKind = "visit" | "bucket";

export function TimelinePhotoPanel(props: TimelinePhotoPanelProps) {
  const {
    selectedBucket,
    activeVisit,
    onOpenPhoto,
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
