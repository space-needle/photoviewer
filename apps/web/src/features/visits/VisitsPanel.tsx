import { useEffect, useState } from "react";

import {
  ensureThumbnails,
  getVisitPhotos,
  getVisits,
  toApiAssetUrl,
  type PhotoListItem,
  type Visit,
} from "../../lib/api";

type VisitsPanelProps = {
  activeVisit: Visit | null;
  onSelectVisit: (visit: Visit) => void;
  onOpenPhoto: (photo: PhotoListItem) => void;
};

export function VisitsPanel(props: VisitsPanelProps) {
  const { activeVisit, onSelectVisit, onOpenPhoto } = props;
  const [visits, setVisits] = useState<Visit[]>([]);
  const [visitPhotos, setVisitPhotos] = useState<PhotoListItem[]>([]);
  const [isLoadingVisits, setIsLoadingVisits] = useState(false);
  const [isLoadingPhotos, setIsLoadingPhotos] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadVisits() {
      setIsLoadingVisits(true);
      setError(null);

      try {
        const response = await getVisits();
        if (!cancelled) {
          setVisits(response.items);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load visits.");
        }
      } finally {
        if (!cancelled) {
          setIsLoadingVisits(false);
        }
      }
    }

    void loadVisits();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadVisitPhotos() {
      if (!activeVisit) {
        setVisitPhotos([]);
        return;
      }

      setIsLoadingPhotos(true);
      setError(null);

      try {
        const response = await getVisitPhotos({ visitId: activeVisit.id });
        const ensured = await ensureThumbnails(response.items.map((photo) => photo.id));
        const thumbnailsById = new Map(
          ensured.items.map((item) => [item.id, item.thumbnail_path]),
        );

        if (!cancelled) {
          setVisitPhotos(
            response.items.map((photo) => ({
              ...photo,
              thumbnail_path: thumbnailsById.get(photo.id) ?? photo.thumbnail_path,
            })),
          );
        }
      } catch (loadError) {
        if (!cancelled) {
          setVisitPhotos([]);
          setError(
            loadError instanceof Error ? loadError.message : "Failed to load visit photos.",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingPhotos(false);
        }
      }
    }

    void loadVisitPhotos();

    return () => {
      cancelled = true;
    };
  }, [activeVisit]);

  return (
    <section className="visitsPanel">
      <div className="detailPanelHeader">
        <div>
          <p className="sectionLabel">Visits</p>
          <h3 className="panelTitle">Detected visits</h3>
        </div>
        <span className="statusPill">{visits.length} visits</span>
      </div>

      {isLoadingVisits ? (
        <div className="messageCard">
          <p className="placeholderTitle">Loading visits...</p>
          <p className="placeholderBody">Reading detected visit groups.</p>
        </div>
      ) : null}

      {error ? (
        <div className="messageCard errorCard">
          <p className="placeholderTitle">Could not load visits</p>
          <p className="placeholderBody">{error}</p>
        </div>
      ) : null}

      {!isLoadingVisits && !error && visits.length === 0 ? (
        <div className="emptyStateCard">
          <p className="placeholderTitle">No visits detected yet</p>
          <p className="placeholderBody">Run the visit detection script to create visit groups.</p>
        </div>
      ) : null}

      {visits.length > 0 ? (
        <div className="visitList">
          {visits.map((visit) => (
            <button
              key={visit.id}
              type="button"
              className={activeVisit?.id === visit.id ? "visitCard active" : "visitCard"}
              onClick={() => onSelectVisit(visit)}
            >
              <strong>{visit.title ?? "Visit"}</strong>
              <span>{visit.start_time} to {visit.end_time}</span>
              <span>{visit.photo_count} photos</span>
              {visit.location_label ? <span>{visit.location_label}</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      {activeVisit ? (
        <div className="visitPhotosPanel">
          <p className="sectionLabel">Visit photos</p>
          {isLoadingPhotos ? (
            <p className="placeholderBody">Preparing thumbnails...</p>
          ) : (
            <div className="thumbnailGrid">
              {visitPhotos.map((photo) => (
                <button
                  key={photo.id}
                  type="button"
                  className="thumbnailButton"
                  onClick={() => onOpenPhoto(photo)}
                >
                  <img
                    className="thumbnailImage"
                    src={toApiAssetUrl(photo.thumbnail_path) ?? ""}
                    alt={photo.file_name}
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
