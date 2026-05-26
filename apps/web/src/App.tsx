import { useCallback, useEffect, useState } from "react";

import { PhotoMap } from "./features/map/PhotoMap";
import { PhotoViewerModal } from "./features/photos/PhotoViewerModal";
import { TimelinePhotoPanel } from "./features/photos/TimelinePhotoPanel";
import { HeatRibbonTimeline } from "./features/timeline/HeatRibbonTimeline";
import { OverviewTimeline } from "./features/timeline/OverviewTimeline";
import {
  ensureThumbnails,
  getPhoto,
  getPhotoRange,
  getMapPoints,
  getTimelineBuckets,
  getVisits,
  type MapPoint,
  type PhotoDetail,
  type PhotoListItem,
  type TimelineBucket,
  type TimelineBucketsResponse,
  type TimelineZoom,
  type Visit,
} from "./lib/api";

type TabKey = "timeline" | "map";
type TimeRange = {
  start: string;
  end: string;
};

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: "timeline", label: "Timeline" },
  { key: "map", label: "Map" },
];

const zoomOptions: TimelineZoom[] = ["overview", "mid", "detail"];
const zoomScaleDefaults: Record<TimelineZoom, number> = {
  overview: 0.65,
  mid: 1.2,
  detail: 2.2,
};

function zoomFromScale(scale: number): TimelineZoom {
  if (scale < 0.8) {
    return "overview";
  }

  if (scale < 1.8) {
    return "mid";
  }

  return "detail";
}

function formatDateInput(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(value.getDate()).padStart(2, "0")}`;
}

function toIsoBoundary(value: string, boundary: "start" | "end"): string {
  const date = new Date(`${value}T00:00:00`);

  if (boundary === "end") {
    date.setDate(date.getDate() + 1);
  }

  return `${formatDateInput(date)}T00:00:00`;
}

function formatDateTimeLocal(value: Date): string {
  return `${formatDateInput(value)}T${String(value.getHours()).padStart(
    2,
    "0",
  )}:${String(value.getMinutes()).padStart(2, "0")}:${String(
    value.getSeconds(),
  ).padStart(2, "0")}`;
}

function buildDefaultRange() {
  const end = new Date();
  const start = new Date(end);
  start.setMonth(end.getMonth() - 3);

  return {
    start: toIsoBoundary(formatDateInput(start), "start"),
    end: toIsoBoundary(formatDateInput(end), "end"),
  };
}

function formatRangeLabel(range: TimeRange): string {
  return `${range.start} to ${range.end}`;
}

function formatVisibleRangeLabel(range: TimeRange): string {
  const start = new Date(range.start);
  const end = new Date(range.end);
  const displayEnd = new Date(end);

  if (
    displayEnd.getHours() === 0 &&
    displayEnd.getMinutes() === 0 &&
    displayEnd.getSeconds() === 0 &&
    displayEnd.getMilliseconds() === 0
  ) {
    displayEnd.setSeconds(displayEnd.getSeconds() - 1);
  }

  if (Number.isNaN(start.getTime()) || Number.isNaN(displayEnd.getTime())) {
    return formatRangeLabel(range);
  }

  return `${new Intl.DateTimeFormat(undefined, {
    month: "short",
    year: "numeric",
  }).format(start)} – ${new Intl.DateTimeFormat(undefined, {
    month: "short",
    year: "numeric",
  }).format(displayEnd)}`;
}

function sameRange(left: TimeRange, right: TimeRange): boolean {
  return left.start === right.start && left.end === right.end;
}

function normalizePhotoLibraryRange(start: string | null, end: string | null): TimeRange {
  if (!start || !end) {
    return buildDefaultRange();
  }

  return {
    start: toIsoBoundary(start.slice(0, 10), "start"),
    end: toIsoBoundary(end.slice(0, 10), "end"),
  };
}

function visitToTimeRange(visit: Visit): TimeRange {
  const end = new Date(visit.end_time);
  end.setSeconds(end.getSeconds() + 1);

  return {
    start: visit.start_time,
    end: formatDateTimeLocal(end),
  };
}

function getAvailableYears(buckets: TimelineBucket[]): number[] {
  return Array.from(
    new Set(
      buckets
        .map((bucket) => new Date(bucket.bucket_start).getFullYear())
        .filter((year) => !Number.isNaN(year)),
    ),
  ).sort((left, right) => left - right);
}

function TopBar() {
  return (
    <header className="topbar">
      <div>
        <h1>Photoviewer</h1>
      </div>
    </header>
  );
}

function TabNavigation(props: {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
}) {
  const { activeTab, onTabChange } = props;

  return (
    <nav className="tabBar" aria-label="Primary">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className={tab.key === activeTab ? "tab active" : "tab"}
          onClick={() => onTabChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

function TimelinePage(props: {
  zoom: TimelineZoom;
  scale: number;
  onScaleChange: (scale: number) => void;
  timelineRange: TimeRange;
  visibleRange: TimeRange;
  onVisibleRangeChange: (range: TimeRange) => void;
  selectedBucket: TimelineBucket | null;
  onSelectedBucketChange: (bucket: TimelineBucket | null) => void;
  activeVisit: Visit | null;
  onActiveVisitChange: (visit: Visit | null) => void;
  onRenameVisit: (visit: Visit) => void;
  visits: Visit[];
}) {
  const {
    zoom,
    scale,
    onScaleChange,
    timelineRange,
    onVisibleRangeChange,
    selectedBucket,
    onSelectedBucketChange,
    activeVisit,
    onActiveVisitChange,
    onRenameVisit,
    visits,
  } = props;
  const [timelineData, setTimelineData] = useState<TimelineBucketsResponse | null>(
    null,
  );
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [activePhoto, setActivePhoto] = useState<PhotoDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const availableYears = getAvailableYears(timelineData?.buckets ?? []);
  const selectedYearIndex =
    selectedYear === null ? -1 : availableYears.indexOf(selectedYear);
  const previousYear =
    selectedYearIndex > 0 ? availableYears[selectedYearIndex - 1] : null;
  const nextYear =
    selectedYearIndex >= 0 && selectedYearIndex < availableYears.length - 1
      ? availableYears[selectedYearIndex + 1]
      : null;

  async function handleOpenPhoto(photo: PhotoListItem) {
    try {
      const detail = await getPhoto(photo.id);
      setActivePhoto(detail);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load the selected photo.",
      );
    }
  }

  function handleBucketSelect(bucket: TimelineBucket) {
    onActiveVisitChange(null);
    onSelectedBucketChange(bucket);
  }

  function handleVisitSelect(visit: Visit) {
    onSelectedBucketChange(null);
    onActiveVisitChange(visit);
    onVisibleRangeChange(visitToTimeRange(visit));
  }

  function handleClearSelection() {
    onSelectedBucketChange(null);
    onActiveVisitChange(null);
  }

  function handleYearChange(year: number) {
    handleClearSelection();
    setSelectedYear(year);
    onVisibleRangeChange({
      start: `${year}-01-01T00:00:00`,
      end: `${year + 1}-01-01T00:00:00`,
    });
  }

  const yearBuckets = selectedYear
    ? timelineData?.buckets.filter((bucket) => {
        const bucketYear = new Date(bucket.bucket_start).getFullYear();
        return bucketYear === selectedYear;
      }) ?? []
    : [];

  useEffect(() => {
    let cancelled = false;

    async function loadTimeline() {
      if (!timelineRange.start || !timelineRange.end) {
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const response = await getTimelineBuckets({
          start: timelineRange.start,
          end: timelineRange.end,
          zoom,
          includeEmpty: true,
        });

        if (cancelled) {
          return;
        }

        setTimelineData(response);
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        setTimelineData(null);
        onSelectedBucketChange(null);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load timeline data.",
        );
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadTimeline();

    return () => {
      cancelled = true;
    };
  }, [onSelectedBucketChange, timelineRange.end, timelineRange.start, zoom]);

  return (
    <section className="panel">
      <div className="panelHeader">
        <div>
          <p className="sectionLabel">View</p>
          <h2>Timeline</h2>
        </div>
        <span className="statusPill">
          {timelineData ? `${timelineData.buckets.length} buckets` : "Live"}
        </span>
      </div>

      {isLoading ? (
        <div className="messageCard">
          <p className="placeholderTitle">Loading timeline…</p>
          <p className="placeholderBody">Fetching bucketed timeline data.</p>
        </div>
      ) : null}

      {error ? (
        <div className="messageCard errorCard">
          <p className="placeholderTitle">Could not load timeline</p>
          <p className="placeholderBody">{error}</p>
        </div>
      ) : null}

      {!error && timelineData ? (
        <>
          {selectedYear === null ? (
            <OverviewTimeline
              buckets={timelineData.buckets}
              onYearSelect={handleYearChange}
            />
          ) : (
            <>
              <div className="yearDetailHeader">
                <button
                  type="button"
                  className="overviewBackButton"
                  onClick={() => {
                    handleClearSelection();
                    setSelectedYear(null);
                  }}
                >
                  ← Overview
                </button>
                <button
                  type="button"
                  className="yearStepButton"
                  disabled={previousYear === null}
                  onClick={() => {
                    if (previousYear !== null) {
                      handleYearChange(previousYear);
                    }
                  }}
                >
                  {previousYear ? `‹ ${previousYear}` : "‹"}
                </button>
                <h3>{selectedYear}</h3>
                <button
                  type="button"
                  className="yearStepButton"
                  disabled={nextYear === null}
                  onClick={() => {
                    if (nextYear !== null) {
                      handleYearChange(nextYear);
                    }
                  }}
                >
                  {nextYear ? `${nextYear} ›` : "›"}
                </button>
              </div>

              <HeatRibbonTimeline
                buckets={yearBuckets}
                zoom="overview"
                scale={scale}
                activeVisit={activeVisit}
                selectedBucket={selectedBucket}
                visits={visits}
                onSelectBucket={handleBucketSelect}
                onSelectVisit={handleVisitSelect}
                onRenameVisit={onRenameVisit}
                onScaleChange={onScaleChange}
                onVisibleRangeChange={onVisibleRangeChange}
              />

              <TimelinePhotoPanel
                activeVisit={activeVisit}
                selectedBucket={selectedBucket}
                timelineBuckets={yearBuckets}
                onOpenPhoto={handleOpenPhoto}
                onSelectBucket={handleBucketSelect}
                onRenameVisit={onRenameVisit}
                onClearSelection={handleClearSelection}
              />
            </>
          )}
        </>
      ) : null}

      <PhotoViewerModal photo={activePhoto} onClose={() => setActivePhoto(null)} />
    </section>
  );
}

function MapPage(props: {
  visibleRange: TimeRange;
  selectedBucket: TimelineBucket | null;
  activeVisit: Visit | null;
  visits: Visit[];
  onSelectVisit: (visit: Visit) => void;
}) {
  const { visibleRange, selectedBucket, activeVisit, visits, onSelectVisit } = props;
  const [points, setPoints] = useState<MapPoint[]>([]);
  const [activePhoto, setActivePhoto] = useState<PhotoDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleOpenPhoto(photoId: string) {
    try {
      const detail = await getPhoto(photoId);
      setActivePhoto(detail);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load the selected photo.",
      );
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadPoints() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await getMapPoints({
          start: visibleRange.start,
          end: visibleRange.end,
          cluster: false,
        });
        const pointIds = response.items.map((point) => point.id);
        const ensured =
          pointIds.length > 0 ? await ensureThumbnails(pointIds) : { items: [] };
        const thumbnailsById = new Map(
          ensured.items.map((item) => [item.id, item.thumbnail_path]),
        );

        if (cancelled) {
          return;
        }

        setPoints(
          response.items.map((point) => ({
            ...point,
            thumbnail_path: thumbnailsById.get(point.id) ?? point.thumbnail_path,
          })),
        );
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        setPoints([]);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load map points.",
        );
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadPoints();

    return () => {
      cancelled = true;
    };
  }, [visibleRange.end, visibleRange.start]);

  return (
    <section className="panel mapPanel">
      <div className="panelHeader mapPanelHeader">
        <div>
          <p className="sectionLabel">Heatmap</p>
          <h2>Map</h2>
        </div>
        <span className="statusPill">{points.length} visible</span>
      </div>

      <div className="rangeSummary mapRangeSummary">
        <span>Visible: {formatVisibleRangeLabel(visibleRange)}</span>
        {selectedBucket ? <strong>Selected bucket active</strong> : null}
      </div>

      {isLoading ? (
        <div className="messageCard">
          <p className="placeholderTitle">Loading map…</p>
          <p className="placeholderBody">Fetching GPS-tagged photos.</p>
        </div>
      ) : null}

      {error ? (
        <div className="messageCard errorCard">
          <p className="placeholderTitle">Could not load map</p>
          <p className="placeholderBody">{error}</p>
        </div>
      ) : null}

      {!isLoading && !error && points.length === 0 ? (
        <div className="emptyStateCard">
          <p className="placeholderTitle">No GPS-tagged photos yet</p>
          <p className="placeholderBody">
            Photos without latitude and longitude are excluded from the map.
          </p>
        </div>
      ) : null}

      {!isLoading && !error && points.length > 0 ? (
        <PhotoMap
          points={points}
          selectedBucket={selectedBucket}
          visits={visits}
          activeVisit={activeVisit}
          onSelectVisit={onSelectVisit}
          onOpenPhoto={handleOpenPhoto}
        />
      ) : null}

      <PhotoViewerModal photo={activePhoto} onClose={() => setActivePhoto(null)} />
    </section>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>("timeline");
  const [timelineScale, setTimelineScale] = useState(zoomScaleDefaults.overview);
  const zoom = zoomFromScale(timelineScale);
  const [timelineRange, setTimelineRange] = useState<TimeRange>(() => buildDefaultRange());
  const [visibleRange, setVisibleRange] = useState<TimeRange>(() => buildDefaultRange());
  const [selectedBucket, setSelectedBucket] = useState<TimelineBucket | null>(null);
  const [activeVisit, setActiveVisit] = useState<Visit | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);

  const updateVisibleRange = useCallback((range: TimeRange) => {
    setVisibleRange((current) => (sameRange(current, range) ? current : range));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadVisits() {
      try {
        const response = await getVisits({
          start: timelineRange.start,
          end: timelineRange.end,
          limit: 500,
        });
        if (!cancelled) {
          setVisits(response.items);
        }
      } catch {
        if (!cancelled) {
          setVisits([]);
        }
      }
    }

    void loadVisits();

    return () => {
      cancelled = true;
    };
  }, [timelineRange.end, timelineRange.start]);

  useEffect(() => {
    let cancelled = false;

    async function loadPhotoRange() {
      try {
        const response = await getPhotoRange();
        if (cancelled) {
          return;
        }

        const nextRange = normalizePhotoLibraryRange(response.start, response.end);
        setTimelineRange(nextRange);
        updateVisibleRange(nextRange);
      } catch {
        if (!cancelled) {
          const fallbackRange = buildDefaultRange();
          setTimelineRange(fallbackRange);
          updateVisibleRange(fallbackRange);
        }
      }
    }

    void loadPhotoRange();

    return () => {
      cancelled = true;
    };
  }, [updateVisibleRange]);

  function handleVisitSelect(visit: Visit) {
    setSelectedBucket(null);
    setActiveVisit(visit);
    updateVisibleRange(visitToTimeRange(visit));
  }

  function handleVisitRename(renamedVisit: Visit) {
    setVisits((currentVisits) =>
      currentVisits.map((visit) =>
        visit.id === renamedVisit.id ? renamedVisit : visit,
      ),
    );
    setActiveVisit((currentVisit) =>
      currentVisit?.id === renamedVisit.id ? renamedVisit : currentVisit,
    );
  }

  return (
    <div className="appShell">
      <div className="appFrame">
        <TopBar />
        <TabNavigation activeTab={activeTab} onTabChange={setActiveTab} />
        <main className="content">
          {activeTab === "timeline" ? (
            <TimelinePage
              zoom={zoom}
              scale={timelineScale}
              onScaleChange={setTimelineScale}
              timelineRange={timelineRange}
              visibleRange={visibleRange}
              onVisibleRangeChange={updateVisibleRange}
              selectedBucket={selectedBucket}
              onSelectedBucketChange={setSelectedBucket}
              activeVisit={activeVisit}
              onActiveVisitChange={setActiveVisit}
              onRenameVisit={handleVisitRename}
              visits={visits}
            />
          ) : (
            <MapPage
              visibleRange={visibleRange}
              selectedBucket={selectedBucket}
              activeVisit={activeVisit}
              visits={visits}
              onSelectVisit={handleVisitSelect}
            />
          )}
        </main>
      </div>
    </div>
  );
}
