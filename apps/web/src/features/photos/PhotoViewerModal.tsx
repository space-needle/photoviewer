import { useEffect } from "react";

import {
  getPhotoFileUrl,
  toApiAssetUrl,
  type PhotoDetail,
} from "../../lib/api";

type PhotoViewerModalProps = {
  photo: PhotoDetail | null;
  onClose: () => void;
};

export function PhotoViewerModal(props: PhotoViewerModalProps) {
  const { photo, onClose } = props;

  useEffect(() => {
    if (!photo) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [photo, onClose]);

  if (!photo) {
    return null;
  }

  const fullPhotoSrc = toApiAssetUrl(photo.file_url) ?? getPhotoFileUrl(photo.id);
  const previewSrc =
    fullPhotoSrc ??
    toApiAssetUrl(photo.thumbnail_url) ??
    toApiAssetUrl(photo.thumbnail_path) ??
    getPhotoFileUrl(photo.id);

  return (
    <div className="modalBackdrop" role="presentation" onClick={onClose}>
      <div
        className="modalCard"
        role="dialog"
        aria-modal="true"
        aria-label={photo.file_name}
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="modalCloseButton" onClick={onClose}>
          Close
        </button>

        <img className="modalImage" src={previewSrc} alt={photo.file_name} />

        <div className="modalMeta">
          <h3 className="panelTitle">{photo.file_name}</h3>
          <p className="placeholderBody">{photo.timestamp_normalized}</p>
          <a
            className="importButton modalLink"
            href={fullPhotoSrc}
            target="_blank"
            rel="noreferrer"
          >
            Open full photo
          </a>
        </div>
      </div>
    </div>
  );
}
