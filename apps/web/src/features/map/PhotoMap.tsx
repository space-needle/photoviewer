import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import {
  toApiAssetUrl,
  type MapPoint,
  type TimelineBucket,
  type Visit,
} from "../../lib/api";

type PhotoMapProps = {
  points: MapPoint[];
  selectedBucket: TimelineBucket | null;
  visits: Visit[];
  activeVisit: Visit | null;
  onSelectVisit: (visit: Visit) => void;
  onOpenPhoto: (photoId: string) => void;
};

const markerIcon = L.icon({
  iconUrl: new URL("leaflet/dist/images/marker-icon.png", import.meta.url).toString(),
  iconRetinaUrl: new URL(
    "leaflet/dist/images/marker-icon-2x.png",
    import.meta.url,
  ).toString(),
  shadowUrl: new URL("leaflet/dist/images/marker-shadow.png", import.meta.url).toString(),
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

export function PhotoMap(props: PhotoMapProps) {
  const {
    points,
    selectedBucket,
    visits,
    activeVisit,
    onSelectVisit,
    onOpenPhoto,
  } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    const map = L.map(containerRef.current, {
      center: [20, 0],
      zoom: 2,
      scrollWheelZoom: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    const layer = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerRef.current = layer;

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) {
      return;
    }

    layer.clearLayers();

    if (points.length === 0) {
      map.setView([20, 0], 2);
      return;
    }

    const bounds = L.latLngBounds([]);

    points.forEach((point) => {
      const position = L.latLng(point.lat, point.lon);
      bounds.extend(position);

      const popup = buildPopup(point);
      const isHighlighted = isPointInBucket(point, selectedBucket);
      const marker = isHighlighted
        ? L.circleMarker(position, {
            radius: 10,
            color: "#9a4f00",
            weight: 3,
            fillColor: "#f59e0b",
            fillOpacity: 0.92,
          }).bindPopup(popup)
        : L.marker(position, { icon: markerIcon }).bindPopup(popup);

      marker.on("popupopen", () => {
        const button = popup.querySelector<HTMLButtonElement>("button[data-photo-id]");
        button?.addEventListener("click", () => onOpenPhoto(point.id), { once: true });
      });

      marker.addTo(layer);
    });

    visits.forEach((visit) => {
      if (visit.center_lat === null || visit.center_lon === null) {
        return;
      }

      const position = L.latLng(visit.center_lat, visit.center_lon);
      bounds.extend(position);
      const isActive = activeVisit?.id === visit.id;
      const marker = L.circleMarker(position, {
        radius: isActive ? 15 : 12,
        color: isActive ? "#166534" : "#2f6f4e",
        weight: isActive ? 4 : 3,
        fillColor: isActive ? "#22c55e" : "#86efac",
        fillOpacity: 0.88,
      }).bindPopup(buildVisitPopup(visit));

      marker.on("click", () => onSelectVisit(visit));
      marker.addTo(layer);
    });

    map.fitBounds(bounds, {
      maxZoom: 14,
      padding: [28, 28],
    });
  }, [activeVisit, onOpenPhoto, onSelectVisit, points, selectedBucket, visits]);

  return <div ref={containerRef} className="mapCanvas" aria-label="Photo map" />;
}

function buildVisitPopup(visit: Visit): HTMLElement {
  const popup = document.createElement("div");
  popup.className = "mapPopup";

  const title = document.createElement("strong");
  title.textContent = visit.title ?? "Visit";
  popup.append(title);

  const timestamp = document.createElement("span");
  timestamp.textContent = `${visit.start_time} to ${visit.end_time}`;
  popup.append(timestamp);

  const count = document.createElement("span");
  count.textContent = `${visit.photo_count} photos`;
  popup.append(count);

  return popup;
}

function isPointInBucket(point: MapPoint, bucket: TimelineBucket | null): boolean {
  if (!bucket) {
    return false;
  }

  const timestamp = new Date(point.timestamp_normalized).getTime();
  const start = new Date(bucket.bucket_start).getTime();
  const end = new Date(bucket.bucket_end).getTime();

  return timestamp >= start && timestamp < end;
}

function buildPopup(point: MapPoint): HTMLElement {
  const popup = document.createElement("div");
  popup.className = "mapPopup";

  const title = document.createElement("strong");
  title.textContent = point.file_name;
  popup.append(title);

  const timestamp = document.createElement("span");
  timestamp.textContent = point.timestamp_normalized;
  popup.append(timestamp);

  const thumbnailUrl = toApiAssetUrl(point.thumbnail_path);
  if (thumbnailUrl) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mapPopupThumbButton";
    button.dataset.photoId = point.id;

    const image = document.createElement("img");
    image.src = thumbnailUrl;
    image.alt = point.file_name;
    image.className = "mapPopupThumb";
    button.append(image);

    popup.append(button);
  }

  return popup;
}
