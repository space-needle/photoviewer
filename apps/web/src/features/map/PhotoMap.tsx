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
  const heatLayerRef = useRef<PhotoHeatLayer | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    const map = L.map(containerRef.current, {
      center: [20, 0],
      zoom: 2,
      scrollWheelZoom: true,
      zoomControl: false,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(map);

    const heatLayer = new PhotoHeatLayer([]);
    heatLayer.addTo(map);
    const layer = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerRef.current = layer;
    heatLayerRef.current = heatLayer;

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      heatLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    const heatLayer = heatLayerRef.current;
    if (!map || !layer) {
      return;
    }

    layer.clearLayers();
    heatLayer?.setPoints(points);

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
            radius: 7,
            color: "#fff7ed",
            weight: 2,
            fillColor: "#fb923c",
            fillOpacity: 0.78,
          }).bindPopup(popup)
        : L.circleMarker(position, {
            radius: 4,
            color: "rgba(255,255,255,0.66)",
            weight: 1,
            fillColor: "#38bdf8",
            fillOpacity: 0.7,
          }).bindPopup(popup);

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
        radius: isActive ? 8 : 5,
        color: isActive ? "#fef9c3" : "rgba(255,255,255,0.7)",
        weight: isActive ? 2 : 1,
        fillColor: isActive ? "#facc15" : "#22c55e",
        fillOpacity: isActive ? 0.78 : 0.7,
      }).bindPopup(buildVisitPopup(visit));

      marker.on("click", () => onSelectVisit(visit));
      marker.addTo(layer);
    });

    map.fitBounds(bounds, { maxZoom: 14, padding: [28, 28] });
  }, [activeVisit, onOpenPhoto, onSelectVisit, points, selectedBucket, visits]);

  function handleRecenter() {
    const map = mapRef.current;
    if (!map || points.length === 0) {
      return;
    }

    const bounds = L.latLngBounds(points.map((point) => [point.lat, point.lon]));
    map.fitBounds(bounds, { maxZoom: 14, padding: [28, 28] });
  }

  function handleLocate() {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    map.locate({ setView: true, maxZoom: 13 });
  }

  return (
    <div className="mapStage">
      <div ref={containerRef} className="mapCanvas" aria-label="Photo map" />
      <div className="mapFloatingTop">
        <button
          type="button"
          className="mapFloatButton"
          aria-label="Recenter map"
          onClick={handleRecenter}
        >
          &lt;
        </button>
        <button type="button" className="mapFloatButton" aria-label="Map options">
          ...
        </button>
      </div>
      <button
        type="button"
        className="mapFloatButton mapLocateButton"
        aria-label="Locate me"
        onClick={handleLocate}
      >
        +
      </button>
    </div>
  );
}

type HeatPoint = Pick<MapPoint, "lat" | "lon">;

class PhotoHeatLayer extends L.Layer {
  private points: HeatPoint[];
  private canvas: HTMLCanvasElement | null = null;
  private map: L.Map | null = null;

  constructor(points: HeatPoint[]) {
    super();
    this.points = points;
  }

  onAdd(map: L.Map): this {
    this.map = map;
    this.canvas = L.DomUtil.create("canvas", "photoHeatLayer");
    const pane = map.getPane("overlayPane");
    pane?.appendChild(this.canvas);
    map.on("move zoom resize", this.draw, this);
    this.draw();
    return this;
  }

  onRemove(map: L.Map): this {
    map.off("move zoom resize", this.draw, this);
    this.canvas?.remove();
    this.canvas = null;
    this.map = null;
    return this;
  }

  setPoints(points: HeatPoint[]) {
    this.points = points;
    this.draw();
  }

  private draw() {
    if (!this.map || !this.canvas) {
      return;
    }

    const size = this.map.getSize();
    const topLeft = this.map.containerPointToLayerPoint([0, 0]);
    const pixelRatio = window.devicePixelRatio || 1;
    this.canvas.width = size.x * pixelRatio;
    this.canvas.height = size.y * pixelRatio;
    this.canvas.style.width = `${size.x}px`;
    this.canvas.style.height = `${size.y}px`;
    L.DomUtil.setPosition(this.canvas, topLeft);

    const context = this.canvas.getContext("2d");
    if (!context) {
      return;
    }

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, size.x, size.y);
    context.globalCompositeOperation = "lighter";

    const zoom = this.map.getZoom();
    const radius = Math.max(22, Math.min(54, zoom * 3.8));

    this.points.forEach((point) => {
      const projected = this.map!.latLngToContainerPoint([point.lat, point.lon]);
      const gradient = context.createRadialGradient(
        projected.x,
        projected.y,
        0,
        projected.x,
        projected.y,
        radius,
      );
      gradient.addColorStop(0, "rgba(255, 71, 87, 0.42)");
      gradient.addColorStop(0.22, "rgba(251, 146, 60, 0.32)");
      gradient.addColorStop(0.48, "rgba(250, 204, 21, 0.22)");
      gradient.addColorStop(0.7, "rgba(34, 197, 94, 0.16)");
      gradient.addColorStop(1, "rgba(99, 102, 241, 0)");

      context.fillStyle = gradient;
      context.beginPath();
      context.arc(projected.x, projected.y, radius, 0, Math.PI * 2);
      context.fill();
    });

    context.globalCompositeOperation = "source-over";
  }
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

  const thumbnailUrl =
    toApiAssetUrl(point.thumbnail_url) ?? toApiAssetUrl(point.thumbnail_path);
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
