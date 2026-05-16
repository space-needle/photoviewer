import { useEffect, useState } from "react";

import {
  ensureThumbnails,
  getPhotosInBucket,
  toApiAssetUrl,
  type PhotoListItem,
  type TimelineBucket,
} from "../../lib/api";

type BucketDetailPanelProps = {
  bucket: TimelineBucket | null;
  onOpenPhoto: (photo: PhotoListItem) => void;
};

export function BucketDetailPanel(props: BucketDetailPanelProps) {
  const { bucket, onOpenPhoto } = props;
  const [photos, setPhotos] = useState<PhotoListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPhotos() {
      if (!bucket) {
        setPhotos([]);
        setTotal(0);
        setError(null);
        return;
      }

      if (bucket.photo_count === 0) {
        setPhotos([]);
        setTotal(0);
        setError(null);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const photoResponse = await getPhotosInBucket({
          bucketStart: bucket.bucket_start,
          bucketEnd: bucket.bucket_end,
        });

        const ensured = await ensureThumbnails(photoResponse.items.map((photo) => photo.id));
        const thumbnailsById = new Map(
          ensured.items.map((item) => [item.id, item.thumbnail_path]),
        );

        if (cancelled) {
          return;
        }

        setTotal(photoResponse.total);
        setPhotos(
          photoResponse.items.map((photo) => ({
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
            : "Failed to load photos for this bucket.",
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
  }, [bucket]);

  return (
    <section className="detailPanel">
      <div className="detailPanelHeader">
        <div>
          <p className="sectionLabel">Bucket detail</p>
          <h3 className="panelTitle">Photos in selected range</h3>
        </div>
        <span className="statusPill">{total} photos</span>
      </div>

      {bucket ? (
        <div className="bucketSummary">
          <p>
            <strong>Start:</strong> {bucket.bucket_start}
          </p>
          <p>
            <strong>End:</strong> {bucket.bucket_end}
          </p>
        </div>
      ) : (
        <p className="placeholderBody">Select a timeline bucket to inspect its photos.</p>
      )}

      {bucket && bucket.photo_count === 0 ? (
        <div className="emptyStateCard">
          <p className="placeholderTitle">No photos in this bucket</p>
          <p className="placeholderBody">
            This time range is empty, so there are no thumbnails to show.
          </p>
        </div>
      ) : null}

      {isLoading ? (
        <div className="messageCard">
          <p className="placeholderTitle">Loading photos…</p>
          <p className="placeholderBody">Preparing thumbnails for the selected bucket.</p>
        </div>
      ) : null}

      {error ? (
        <div className="messageCard errorCard">
          <p className="placeholderTitle">Could not load bucket photos</p>
          <p className="placeholderBody">{error}</p>
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
  );
}
