import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type TouchEvent,
  type WheelEvent,
} from "react";

import type { TimelineBucket, TimelineZoom, Visit } from "../../lib/api";
import { EditableVisitTitle } from "../visits/EditableVisitTitle";

const MONTH_SEGMENT_HEIGHT = 28;
const MID_DAY_HEIGHT = 7;
const DETAIL_BUCKET_HEIGHT = 48;
const MIN_TIMELINE_SCALE = 0.4;
const MAX_TIMELINE_SCALE = 3;

const dotClasses = [
  "densityDotLevel0",
  "densityDotLevel1",
  "densityDotLevel2",
  "densityDotLevel3",
  "densityDotLevel4",
] as const;

type PinchTouchList = {
  readonly [index: number]: {
    clientX: number;
    clientY: number;
  };
};

type HeatRibbonTimelineProps = {
  buckets: TimelineBucket[];
  zoom: TimelineZoom;
  scale: number;
  selectedBucket: TimelineBucket | null;
  activeVisit: Visit | null;
  visits: Visit[];
  onSelectBucket: (bucket: TimelineBucket) => void;
  onSelectVisit: (visit: Visit) => void;
  onRenameVisit: (visit: Visit) => void;
  onScaleChange: (scale: number) => void;
  onVisibleRangeChange?: (range: { start: string; end: string }) => void;
};

type MonthSegment = {
  key: string;
  labelMonth: string;
  labelYear: string;
  isQuarterLabel: boolean;
  isYearStart: boolean;
  start: string;
  end: string;
  buckets: TimelineBucket[];
};

type TimelineItem =
  | {
      type: "header";
      key: string;
      label: string;
    }
  | {
      type: "bucket";
      bucket: TimelineBucket;
    };

type TenDayBucket = TimelineBucket & {
  bucketIndex: 1 | 2 | 3;
  label: string;
};

export function HeatRibbonTimeline(props: HeatRibbonTimelineProps) {
  const {
    buckets,
    zoom,
    scale,
    selectedBucket,
    activeVisit,
    visits,
    onSelectBucket,
    onSelectVisit,
    onRenameVisit,
    onScaleChange,
    onVisibleRangeChange,
  } = props;
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const scrollTimerRef = useRef<number | null>(null);
  const lastVisibleRangeRef = useRef<string | null>(null);
  const pinchRef = useRef<{
    distance: number;
    scale: number;
    centerY: number;
  } | null>(null);
  const pendingZoomAnchorRef = useRef<{
    focusOffset: number;
    timestamp: number;
  } | null>(null);
  const fallbackZoomAnchorRef = useRef<{
    focusOffset: number;
    timestamp: number;
  } | null>(null);
  const maxVisibleCount = Math.max(
    0,
    ...buckets.map((bucket) => bucket.photo_count),
  );
  const hasPhotos = buckets.some((bucket) => bucket.photo_count > 0);
  const reportVisibleRange = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || !onVisibleRangeChange) {
      return;
    }

    const visibleItems = Array.from(
      container.querySelectorAll<HTMLElement>("[data-visible-start][data-visible-end]"),
    );
    const viewport = container.getBoundingClientRect();
    const firstVisible = visibleItems.find((item) => {
      const rect = item.getBoundingClientRect();
      return rect.bottom >= viewport.top && rect.top <= viewport.bottom;
    });
    let lastVisible: HTMLElement | undefined;

    for (let index = visibleItems.length - 1; index >= 0; index -= 1) {
      const item = visibleItems[index];
      const rect = item.getBoundingClientRect();
      if (rect.bottom >= viewport.top && rect.top <= viewport.bottom) {
        lastVisible = item;
        break;
      }
    }

    if (!firstVisible || !lastVisible) {
      return;
    }

    const start = firstVisible.dataset.visibleStart;
    const end = lastVisible.dataset.visibleEnd;
    if (!start || !end) {
      return;
    }

    const rangeKey = `${start}|${end}`;
    if (lastVisibleRangeRef.current === rangeKey) {
      return;
    }

    lastVisibleRangeRef.current = rangeKey;
    onVisibleRangeChange({ start, end });
  }, [onVisibleRangeChange]);

  const handleScroll = useCallback(() => {
    if (!onVisibleRangeChange) {
      return;
    }

    if (scrollTimerRef.current !== null) {
      window.clearTimeout(scrollTimerRef.current);
    }

    scrollTimerRef.current = window.setTimeout(() => {
      reportVisibleRange();
    }, 140);
  }, [onVisibleRangeChange, reportVisibleRange]);

  const updateScaleAroundPoint = useCallback(
    (nextScale: number, clientY: number) => {
      const container = scrollContainerRef.current;
      if (!container) {
        return;
      }

      const clampedScale = clampScale(nextScale);
      if (Math.abs(clampedScale - scale) < 0.001) {
        return;
      }

      const viewport = container.getBoundingClientRect();
      const focusOffset = Math.max(0, Math.min(clientY - viewport.top, viewport.height));
      const anchorTimestamp = getTimestampAtViewportOffset(container, focusOffset);

      if (anchorTimestamp !== null) {
        pendingZoomAnchorRef.current = {
          focusOffset,
          timestamp: anchorTimestamp,
        };
      }
      onScaleChange(clampedScale);
    },
    [onScaleChange, scale],
  );

  const handleWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }

      event.preventDefault();
      const zoomFactor = Math.exp(-event.deltaY * 0.002);
      updateScaleAroundPoint(scale * zoomFactor, event.clientY);
    },
    [scale, updateScaleAroundPoint],
  );

  const handleTouchStart = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      if (event.touches.length !== 2) {
        pinchRef.current = null;
        return;
      }

      pinchRef.current = {
        distance: getTouchDistance(event.touches),
        scale,
        centerY: getTouchCenterY(event.touches),
      };
    },
    [scale],
  );

  const handleTouchMove = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      const pinch = pinchRef.current;
      if (!pinch || event.touches.length !== 2) {
        return;
      }

      event.preventDefault();
      const distance = getTouchDistance(event.touches);
      const centerY = getTouchCenterY(event.touches);
      updateScaleAroundPoint(pinch.scale * (distance / pinch.distance), centerY);
    },
    [updateScaleAroundPoint],
  );

  const handleTouchEnd = useCallback((event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length < 2) {
      pinchRef.current = null;
    }
  }, []);

  useLayoutEffect(() => {
    const anchor = pendingZoomAnchorRef.current ?? fallbackZoomAnchorRef.current;
    const container = scrollContainerRef.current;

    if (!anchor || !container) {
      return;
    }

    if (restoreScrollToTimestamp(container, anchor.timestamp, anchor.focusOffset)) {
      pendingZoomAnchorRef.current = null;
      fallbackZoomAnchorRef.current = null;
    }
    window.requestAnimationFrame(reportVisibleRange);
  }, [buckets, reportVisibleRange, scale, zoom]);

  useLayoutEffect(() => {
    return () => {
      const container = scrollContainerRef.current;
      if (!container || pendingZoomAnchorRef.current) {
        return;
      }

      const focusOffset = container.clientHeight / 2;
      const timestamp = getTimestampAtViewportOffset(container, focusOffset);
      if (timestamp !== null) {
        fallbackZoomAnchorRef.current = { focusOffset, timestamp };
      }
    };
  }, [scale, zoom]);

  useEffect(() => {
    lastVisibleRangeRef.current = null;
    const frame = window.requestAnimationFrame(reportVisibleRange);

    return () => {
      window.cancelAnimationFrame(frame);
      if (scrollTimerRef.current !== null) {
        window.clearTimeout(scrollTimerRef.current);
      }
    };
  }, [buckets, reportVisibleRange, zoom]);

  if (buckets.length === 0) {
    return (
      <div className="emptyStateCard">
        <p className="placeholderTitle">No buckets in this range</p>
        <p className="placeholderBody">
          Try widening the date range or choosing a different zoom level.
        </p>
      </div>
    );
  }

  return (
    <>
      <DensityLegend />

      {!hasPhotos ? (
        <div className="emptyStateCard">
          <p className="placeholderTitle">No photos found in this range.</p>
          <p className="placeholderBody">
            Try a wider date range or a different zoom level.
          </p>
        </div>
      ) : null}

      <div
        ref={scrollContainerRef}
        className="timelineViewport"
        aria-label="Timeline buckets"
        style={{ "--timeline-scale": scale } as CSSProperties}
        onScroll={handleScroll}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {zoom === "overview" ? (
          <>
            <MobileTimelineHeatmap
              buckets={buckets}
              selectedBucket={selectedBucket}
              onSelectBucket={onSelectBucket}
            />
            <div className="desktopTimelineContent">
              <OverviewDotTimeline
                buckets={buckets}
                scale={scale}
                maxVisibleCount={maxVisibleCount}
                onSelectBucket={onSelectBucket}
                onSelectVisit={onSelectVisit}
                onRenameVisit={onRenameVisit}
                activeVisit={activeVisit}
                selectedBucket={selectedBucket}
                visits={visits}
              />
            </div>
          </>
        ) : zoom === "mid" ? (
          <MidDotTimeline
            buckets={buckets}
            scale={scale}
            onSelectBucket={onSelectBucket}
            onSelectVisit={onSelectVisit}
            onRenameVisit={onRenameVisit}
            activeVisit={activeVisit}
            selectedBucket={selectedBucket}
            visits={visits}
          />
        ) : (
          <BucketDotTimeline
            buckets={buckets}
            maxVisibleCount={maxVisibleCount}
            scale={scale}
            onSelectBucket={onSelectBucket}
            selectedBucket={selectedBucket}
            zoom={zoom}
          />
        )}
      </div>
    </>
  );
}

function MobileTimelineHeatmap(props: {
  buckets: TimelineBucket[];
  selectedBucket: TimelineBucket | null;
  onSelectBucket: (bucket: TimelineBucket) => void;
}) {
  const { buckets, selectedBucket, onSelectBucket } = props;
  const monthSegments = buildMonthSegments(buckets);
  const maxTenDayCount = Math.max(
    0,
    ...monthSegments.flatMap((month) =>
      buildTenDayBuckets(month).map((bucket) => bucket.photo_count),
    ),
  );
  return (
    <div className="mobileTenDayTimeline">
      {monthSegments.map((month) => {
        const tenDayBuckets = buildTenDayBuckets(month);

        return (
          <section
            key={month.key}
            className={month.isYearStart ? "tenDayMonthRow yearStart" : "tenDayMonthRow"}
            data-visible-start={month.start}
            data-visible-end={month.end}
          >
            <div className="tenDayMonthLabel">
              {month.isYearStart ? <strong>{month.labelYear}</strong> : null}
              <span>{month.labelMonth}</span>
            </div>
            <div className="tenDayCells" aria-label={`${month.labelMonth} ${month.labelYear}`}>
              {tenDayBuckets.map((bucket) => {
                const selectedDate = selectedBucket
                  ? parseDate(selectedBucket.bucket_start)
                  : null;
                const isSelected =
                  isSameBucket(selectedBucket, bucket) ||
                  (selectedDate !== null && isDateInBucket(selectedDate, bucket));
                const level = getTenDayDensityLevel(bucket.photo_count, maxTenDayCount);

                return (
                  <button
                    key={`${bucket.bucket_start}-${bucket.bucket_end}`}
                    type="button"
                    className={
                      isSelected
                        ? `tenDayCell tenDayLevel${level} selected`
                        : `tenDayCell tenDayLevel${level}`
                    }
                    title={`${bucket.label}: ${formatPhotoCount(bucket.photo_count)}`}
                    onClick={() => onSelectBucket(bucket)}
                  >
                    <span className="srOnly">
                      Select {bucket.label}, {formatPhotoCount(bucket.photo_count)}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

    </div>
  );
}

function DensityLegend() {
  return (
    <div className="timelineLegend" aria-label="Timeline density legend">
      <span className="legendScaleLabel">Less</span>
      {[1, 2, 3, 4].map((level) => (
        <span
          key={level}
          className={`legendDot ${dotClasses[level]}`}
          style={{ "--dot-size": `${getOverviewDotSize(level)}px` } as CSSProperties}
          aria-hidden="true"
        />
      ))}
      <span className="legendScaleLabel">More</span>
    </div>
  );
}

function OverviewDotTimeline(props: {
  buckets: TimelineBucket[];
  scale: number;
  maxVisibleCount: number;
  activeVisit: Visit | null;
  selectedBucket: TimelineBucket | null;
  visits: Visit[];
  onSelectBucket: (bucket: TimelineBucket) => void;
  onSelectVisit: (visit: Visit) => void;
  onRenameVisit: (visit: Visit) => void;
}) {
  const {
    buckets,
    scale,
    maxVisibleCount,
    activeVisit,
    selectedBucket,
    visits,
    onSelectBucket,
    onSelectVisit,
    onRenameVisit,
  } = props;
  const monthSegments = buildMonthSegments(buckets);
  const visitsByMonth = groupVisitsByMonth(visits);

  return (
    <div className="monthTimeline">
      {monthSegments.map((month) => {
        const monthVisits = visitsByMonth.get(month.key) ?? [];

        return (
          <section
            key={month.key}
            className={month.isYearStart ? "monthSegment yearStart" : "monthSegment"}
            data-visible-start={month.start}
            data-visible-end={month.end}
            style={{ minHeight: `${MONTH_SEGMENT_HEIGHT * scale}px` }}
          >
            <div className="monthLabel" aria-hidden="true">
              {month.isYearStart ? <strong>{month.labelYear}</strong> : null}
              {month.isQuarterLabel ? <span>{month.labelMonth}</span> : null}
            </div>
            <div className="monthLine" aria-hidden="true" />
            <div className="monthDots">
              {month.buckets
                .filter((bucket) => bucket.photo_count > 0)
                .map((bucket) => {
                  const level = getDisplayColorLevel(bucket, maxVisibleCount);
                  const isSelected = isSameBucket(selectedBucket, bucket);
                  const dotStyle = getOverviewDotStyle(bucket, level);

                  return (
                    <button
                      key={`${bucket.bucket_start}-${bucket.bucket_end}`}
                      type="button"
                      className={
                        isSelected
                          ? "timelineDotButton overviewDot selected"
                          : "timelineDotButton overviewDot"
                      }
                      style={dotStyle}
                      title={`${formatBucketLabel(bucket.bucket_start, "overview")}: ${formatPhotoCount(bucket.photo_count)}`}
                      onClick={() => onSelectBucket(bucket)}
                    >
                      <span className={`densityDot ${dotClasses[level]}`} />
                      <span className="srOnly">
                        Select {formatBucketLabel(bucket.bucket_start, "overview")},{" "}
                        {formatPhotoCount(bucket.photo_count)}
                      </span>
                    </button>
                  );
                })}
            </div>
            <TimelineVisitCards
              activeVisit={activeVisit}
              monthKey={month.key}
              onSelectVisit={onSelectVisit}
              onRenameVisit={onRenameVisit}
              visits={monthVisits}
            />
          </section>
        );
      })}
    </div>
  );
}

function MidDotTimeline(props: {
  buckets: TimelineBucket[];
  scale: number;
  activeVisit: Visit | null;
  selectedBucket: TimelineBucket | null;
  visits: Visit[];
  onSelectBucket: (bucket: TimelineBucket) => void;
  onSelectVisit: (visit: Visit) => void;
  onRenameVisit: (visit: Visit) => void;
}) {
  const {
    buckets,
    scale,
    activeVisit,
    selectedBucket,
    visits,
    onSelectBucket,
    onSelectVisit,
    onRenameVisit,
  } = props;
  const dailyBuckets = buildDailyBuckets(buckets);
  const dailyMaxVisibleCount = Math.max(
    0,
    ...dailyBuckets.map((bucket) => bucket.photo_count),
  );
  const monthSegments = buildMonthSegments(dailyBuckets);
  const visitsByMonth = groupVisitsByMonth(visits);

  return (
    <div className="monthTimeline midTimeline">
      {monthSegments.map((month) => {
        const monthVisits = visitsByMonth.get(month.key) ?? [];

        return (
          <section
            key={month.key}
            className={month.isYearStart ? "midMonthSegment yearStart" : "midMonthSegment"}
            style={{ minHeight: `${month.buckets.length * MID_DAY_HEIGHT * scale}px` }}
          >
            <div className="midMonthLabel" aria-hidden="true">
              <span>{month.labelMonth}</span>
              {month.isYearStart ? <strong>{month.labelYear}</strong> : null}
            </div>
            <div className="monthLine" aria-hidden="true" />
            <div className="midDayStack">
              {month.buckets.map((bucket) => {
                const level = getDisplayColorLevel(bucket, dailyMaxVisibleCount);
                const isSelected = isSameBucket(selectedBucket, bucket);
                const date = parseDate(bucket.bucket_start);

                return (
                  <div
                    key={`${bucket.bucket_start}-${bucket.bucket_end}`}
                    className="midDayRow"
                    data-visible-start={bucket.bucket_start}
                    data-visible-end={bucket.bucket_end}
                    style={{ minHeight: `${MID_DAY_HEIGHT * scale}px` }}
                  >
                    {bucket.photo_count > 0 ? (
                      <button
                        type="button"
                        className={
                          isSelected
                            ? "timelineDotButton midDot selected"
                            : "timelineDotButton midDot"
                        }
                        style={
                          {
                            "--dot-size": `${getMidDotSize(level)}px`,
                            "--dot-offset": `${date ? getMidStackOffset(date) : 0}px`,
                          } as CSSProperties
                        }
                        title={`${formatBucketLabel(bucket.bucket_start, "mid")}: ${formatPhotoCount(bucket.photo_count)}`}
                        onClick={() => onSelectBucket(bucket)}
                      >
                        <span className={`densityDot ${dotClasses[level]}`} />
                        <span className="srOnly">
                          Select {formatBucketLabel(bucket.bucket_start, "mid")},{" "}
                          {formatPhotoCount(bucket.photo_count)}
                        </span>
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <TimelineVisitCards
              activeVisit={activeVisit}
              monthKey={month.key}
              onSelectVisit={onSelectVisit}
              onRenameVisit={onRenameVisit}
              visits={monthVisits}
            />
          </section>
        );
      })}
    </div>
  );
}

function TimelineVisitCards(props: {
  activeVisit: Visit | null;
  monthKey: string;
  visits: Visit[];
  onSelectVisit: (visit: Visit) => void;
  onRenameVisit: (visit: Visit) => void;
}) {
  const { activeVisit, monthKey, visits, onSelectVisit, onRenameVisit } = props;
  const [activeIndexByMonth, setActiveIndexByMonth] = useState<Record<string, number>>(
    {},
  );

  if (visits.length === 0) {
    return <div className="monthVisitLane" />;
  }

  const activeIndex = Math.min(activeIndexByMonth[monthKey] ?? 0, visits.length - 1);
  const visit = visits[activeIndex];
  const isSelected = activeVisit?.id === visit.id;

  function moveVisitCard(direction: -1 | 1) {
    setActiveIndexByMonth((current) => {
      const currentIndex = Math.min(current[monthKey] ?? 0, visits.length - 1);
      const nextIndex = (currentIndex + direction + visits.length) % visits.length;
      return { ...current, [monthKey]: nextIndex };
    });
  }

  return (
    <div className="monthVisitLane">
      <article
        className={isSelected ? "timelineVisitCard active" : "timelineVisitCard"}
        style={getOverviewVisitCardStyle(visit)}
      >
        {visits.length > 1 ? (
          <div className="visitCardPager">
            <button
              type="button"
              aria-label="Previous visit"
              onClick={(event) => {
                event.stopPropagation();
                moveVisitCard(-1);
              }}
            >
              Prev
            </button>
            <span>
              {activeIndex + 1} / {visits.length}
            </span>
            <button
              type="button"
              aria-label="Next visit"
              onClick={(event) => {
                event.stopPropagation();
                moveVisitCard(1);
              }}
            >
              Next
            </button>
          </div>
        ) : null}

        <div className="timelineVisitTitleRow">
          <EditableVisitTitle
            className="timelineVisitTitle"
            visit={visit}
            onRenamed={onRenameVisit}
            fallbackTitle={`Visit: ${formatVisitDateRange(visit)}`}
          />
        </div>

        <button
          type="button"
          className="timelineVisitCardButton"
          onClick={() => onSelectVisit(visit)}
        >
          <span>{formatVisitDateRange(visit)}</span>
          <span>{formatPhotoCount(visit.photo_count)}</span>
          {visit.location_label ? <span>{visit.location_label}</span> : null}
        </button>
      </article>
    </div>
  );
}

function BucketDotTimeline(props: {
  buckets: TimelineBucket[];
  maxVisibleCount: number;
  scale: number;
  selectedBucket: TimelineBucket | null;
  onSelectBucket: (bucket: TimelineBucket) => void;
  zoom: Exclude<TimelineZoom, "overview">;
}) {
  const { buckets, maxVisibleCount, scale, selectedBucket, onSelectBucket, zoom } = props;
  const items = buildTimelineItems(buckets, zoom);

  return (
    <div className="bucketDotTimeline">
      {items.map((item) => {
        if (item.type === "header") {
          return (
            <div key={item.key} className="timelineDateHeader">
              {item.label}
            </div>
          );
        }

        const { bucket } = item;
        const isSelected = isSameBucket(selectedBucket, bucket);

        if (bucket.photo_count <= 0) {
          return null;
        }

        const level = getDisplayColorLevel(bucket, maxVisibleCount);

        return (
          <button
            key={`${bucket.bucket_start}-${bucket.bucket_end}`}
            type="button"
            className={isSelected ? "bucketDotRow selected" : "bucketDotRow"}
            data-visible-start={bucket.bucket_start}
            data-visible-end={bucket.bucket_end}
            style={{ minHeight: `${DETAIL_BUCKET_HEIGHT * scale}px` }}
            onClick={() => onSelectBucket(bucket)}
          >
            <span className="bucketDotLineSlot">
              <span className={`densityDot ${dotClasses[level]}`} />
            </span>
            <span className="bucketDotContent">
              <strong>{formatBucketLabel(bucket.bucket_start, zoom)}</strong>
              <span>{formatPhotoCount(bucket.photo_count)}</span>
            </span>
            {bucket.photo_count >= 11 ? (
              <span className="activityPill">High activity</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function buildMonthSegments(buckets: TimelineBucket[]): MonthSegment[] {
  const segments = new Map<string, MonthSegment>();
  const firstDate = parseDate(buckets[0]?.bucket_start ?? "");
  const lastEndDate = parseDate(buckets[buckets.length - 1]?.bucket_end ?? "");

  if (firstDate && lastEndDate) {
    const cursor = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
    const finalMonth = new Date(lastEndDate);
    finalMonth.setDate(finalMonth.getDate() - 1);
    finalMonth.setDate(1);

    while (cursor <= finalMonth) {
      const key = getMonthKey(cursor);
      segments.set(key, createMonthSegment(cursor, key));
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  buckets.forEach((bucket) => {
    const date = parseDate(bucket.bucket_start);
    if (!date) {
      return;
    }

    const key = getMonthKey(date);

    if (!segments.has(key)) {
      segments.set(key, createMonthSegment(date, key));
    }

    const segment = segments.get(key);
    if (!segment) {
      return;
    }

    segment.buckets.push(bucket);
  });

  return Array.from(segments.values());
}

function createMonthSegment(date: Date, key: string): MonthSegment {
  const month = date.getMonth();

  return {
    key,
    start: formatMonthStart(date),
    end: formatNextMonthStart(date),
    labelMonth: new Intl.DateTimeFormat(undefined, {
      month: "short",
    })
      .format(date)
      .toUpperCase(),
    labelYear: String(date.getFullYear()),
    isQuarterLabel: month === 0 || month === 3 || month === 6 || month === 9,
    isYearStart: month === 0,
    buckets: [],
  };
}

function buildDailyBuckets(buckets: TimelineBucket[]): TimelineBucket[] {
  const firstDate = parseDate(buckets[0]?.bucket_start ?? "");
  const lastEndDate = parseDate(buckets[buckets.length - 1]?.bucket_end ?? "");

  if (!firstDate || !lastEndDate) {
    return [];
  }

  const bucketsByDay = new Map<string, TimelineBucket>();
  const cursor = new Date(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate());
  const finalDate = new Date(lastEndDate);
  finalDate.setDate(finalDate.getDate() - 1);
  finalDate.setHours(0, 0, 0, 0);

  while (cursor <= finalDate) {
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

    bucketsByDay.set(dayStart.slice(0, 10), {
      bucket_start: dayStart,
      bucket_end: dayEnd,
      photo_count: 0,
      color_level: 0,
      has_gap_label: false,
      gap_label: null,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  buckets.forEach((bucket) => {
    if (bucket.photo_count <= 0) {
      return;
    }

    const date = parseDate(bucket.bucket_start);
    if (!date) {
      return;
    }

    const dayKey = formatLocalIsoDate(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
    ).slice(0, 10);
    const dayBucket = bucketsByDay.get(dayKey);
    if (!dayBucket) {
      return;
    }

    dayBucket.photo_count += bucket.photo_count;
    dayBucket.color_level = Math.max(dayBucket.color_level, bucket.color_level);
  });

  return Array.from(bucketsByDay.values());
}

function buildTenDayBuckets(month: MonthSegment): TenDayBucket[] {
  const monthStart = parseDate(month.start);
  if (!monthStart) {
    return [];
  }

  const year = monthStart.getFullYear();
  const monthIndex = monthStart.getMonth();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const bucketRanges = [
    { bucketIndex: 1 as const, startDay: 1, endDay: 10 },
    { bucketIndex: 2 as const, startDay: 11, endDay: 20 },
    { bucketIndex: 3 as const, startDay: 21, endDay: daysInMonth },
  ];

  return bucketRanges.map(({ bucketIndex, startDay, endDay }) => {
    const bucketStart = formatLocalIsoDate(year, monthIndex, startDay);
    const bucketEnd = formatLocalIsoDate(year, monthIndex, endDay + 1);
    const photoCount = month.buckets.reduce((total, bucket) => {
      const date = parseDate(bucket.bucket_start);
      if (!date) {
        return total;
      }

      const day = date.getDate();
      return day >= startDay && day <= endDay ? total + bucket.photo_count : total;
    }, 0);

    return {
      bucketIndex,
      bucket_start: bucketStart,
      bucket_end: bucketEnd,
      photo_count: photoCount,
      color_level: quantizeTenDayColorLevel(photoCount),
      has_gap_label: false,
      gap_label: null,
      label: formatTenDayRangeLabel(year, monthIndex, startDay, endDay),
    };
  });
}

function findTenDayBucket(
  monthSegments: MonthSegment[],
  selectedBucket: TimelineBucket,
): TenDayBucket | null {
  const selectedStart = parseDate(selectedBucket.bucket_start);
  if (!selectedStart) {
    return null;
  }

  const monthKey = getMonthKey(selectedStart);
  const month = monthSegments.find((segment) => segment.key === monthKey);
  if (!month) {
    return null;
  }

  return (
    buildTenDayBuckets(month).find((bucket) => isDateInBucket(selectedStart, bucket)) ??
    null
  );
}

function getMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function groupVisitsByMonth(visits: Visit[]): Map<string, Visit[]> {
  const visitsByMonth = new Map<string, Visit[]>();

  visits.forEach((visit) => {
    const date = parseDate(visit.start_time);
    if (!date) {
      return;
    }

    const key = getMonthKey(date);
    const monthVisits = visitsByMonth.get(key) ?? [];
    monthVisits.push(visit);
    visitsByMonth.set(key, monthVisits);
  });

  visitsByMonth.forEach((monthVisits) => {
    monthVisits.sort((left, right) => left.start_time.localeCompare(right.start_time));
  });

  return visitsByMonth;
}

function buildTimelineItems(
  buckets: TimelineBucket[],
  zoom: Exclude<TimelineZoom, "overview">,
): TimelineItem[] {
  const items: TimelineItem[] = [];
  let previousHeader: string | null = null;

  buckets.forEach((bucket) => {
    const header = formatHeaderLabel(bucket.bucket_start, zoom);
    if (header && header !== previousHeader) {
      previousHeader = header;
      items.push({
        type: "header",
        key: `${zoom}-${header}-${bucket.bucket_start}`,
        label: header,
      });
    }

    items.push({ type: "bucket", bucket });
  });

  return items;
}

function getOverviewDotStyle(bucket: TimelineBucket, level: number) {
  const date = parseDate(bucket.bucket_start);
  if (!date) {
    return undefined;
  }

  const dotSize = getOverviewDotSize(level);
  const stackOffset = getOverviewStackOffset(date);

  return {
    top: `calc(${getDayOffsetRatio(date) * 100}% + ${stackOffset}px)`,
    "--dot-size": `${dotSize}px`,
  } as CSSProperties;
}

function getOverviewDotSize(level: number): number {
  return [0, 6, 8, 10, 12][level] ?? 8;
}

function getMidDotSize(level: number): number {
  return [0, 6, 8, 10, 12][level] ?? 8;
}

function getMidStackOffset(date: Date): number {
  return [-1, 0, 1][date.getDate() % 3] ?? 0;
}

function getOverviewStackOffset(date: Date): number {
  return [-1, 0, 1][date.getDate() % 3] ?? 0;
}

function getOverviewVisitCardStyle(visit: Visit) {
  const date = parseDate(visit.start_time);
  if (!date) {
    return undefined;
  }

  return {
    top: `${getDayOffsetRatio(date) * 100}%`,
  } as CSSProperties;
}

function getDayOffsetRatio(date: Date): number {
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return daysInMonth <= 1 ? 0.5 : (date.getDate() - 1) / (daysInMonth - 1);
}

function getDisplayColorLevel(bucket: TimelineBucket, maxVisibleCount: number): number {
  if (bucket.photo_count <= 0) {
    return 0;
  }

  if (maxVisibleCount <= 1) {
    return Math.max(1, bucket.color_level);
  }

  const adaptiveLevel = Math.ceil((bucket.photo_count / maxVisibleCount) * 4);
  return Math.max(bucket.color_level, adaptiveLevel, 1);
}

function quantizeTenDayColorLevel(photoCount: number): number {
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

function getTenDayDensityLevel(photoCount: number, maxVisibleCount: number): number {
  if (photoCount <= 0) {
    return 0;
  }

  const fixedLevel = quantizeTenDayColorLevel(photoCount);
  if (maxVisibleCount <= 1) {
    return fixedLevel;
  }

  const adaptiveLevel = Math.ceil((photoCount / maxVisibleCount) * 5);
  return Math.max(fixedLevel, adaptiveLevel, 1);
}

function getDotSize(level: number): number {
  return [0, 6, 8, 10, 12][level] ?? 8;
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

function isDateInBucket(date: Date, bucket: TimelineBucket): boolean {
  const start = parseDate(bucket.bucket_start);
  const end = parseDate(bucket.bucket_end);
  return start !== null && end !== null && date >= start && date < end;
}

function formatMonthStart(date: Date): string {
  return formatLocalIsoDate(date.getFullYear(), date.getMonth(), 1);
}

function formatNextMonthStart(date: Date): string {
  return formatLocalIsoDate(date.getFullYear(), date.getMonth() + 1, 1);
}

function formatLocalIsoDate(year: number, monthIndex: number, day: number): string {
  const date = new Date(year, monthIndex, day);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getDate()).padStart(2, "0")}T00:00:00`;
}

function formatHeaderLabel(
  value: string,
  zoom: Exclude<TimelineZoom, "overview">,
): string {
  const date = parseDate(value);
  if (!date) {
    return value;
  }

  if (zoom === "mid") {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date);
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
  }).format(date);
}

function formatBucketLabel(value: string, zoom: TimelineZoom): string {
  const date = parseDate(value);
  if (!date) {
    return value;
  }

  if (zoom === "overview") {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date);
  }

  if (zoom === "mid") {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
    }).format(date);
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatPhotoCount(count: number): string {
  return count === 1 ? "1 photo" : `${count} photos`;
}

function formatTenDayRangeLabel(
  year: number,
  monthIndex: number,
  startDay: number,
  endDay: number,
): string {
  const start = new Date(year, monthIndex, startDay);
  const monthLabel = new Intl.DateTimeFormat(undefined, {
    month: "short",
  }).format(start);
  return `${monthLabel} ${startDay}-${endDay}, ${year}`;
}

function clampScale(value: number): number {
  return Math.min(MAX_TIMELINE_SCALE, Math.max(MIN_TIMELINE_SCALE, value));
}

function getTimelineRangeElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>("[data-visible-start][data-visible-end]"),
  );
}

function getElementTimeRange(element: HTMLElement): {
  start: number;
  end: number;
} | null {
  const startValue = element.dataset.visibleStart;
  const endValue = element.dataset.visibleEnd;
  if (!startValue || !endValue) {
    return null;
  }

  const start = new Date(startValue).getTime();
  const end = new Date(endValue).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || start >= end) {
    return null;
  }

  return { start, end };
}

function getTimestampAtViewportOffset(
  container: HTMLElement,
  focusOffset: number,
): number | null {
  const focusY = container.getBoundingClientRect().top + focusOffset;
  const elements = getTimelineRangeElements(container);
  let nearest: {
    element: HTMLElement;
    distance: number;
    range: { start: number; end: number };
  } | null = null;

  for (const element of elements) {
    const range = getElementTimeRange(element);
    if (!range) {
      continue;
    }

    const rect = element.getBoundingClientRect();
    const height = Math.max(rect.height, 1);
    if (focusY >= rect.top && focusY <= rect.bottom) {
      const ratio = Math.max(0, Math.min(1, (focusY - rect.top) / height));
      return range.start + (range.end - range.start) * ratio;
    }

    const distance = Math.min(Math.abs(focusY - rect.top), Math.abs(focusY - rect.bottom));
    if (!nearest || distance < nearest.distance) {
      nearest = { element, distance, range };
    }
  }

  if (!nearest) {
    return null;
  }

  const rect = nearest.element.getBoundingClientRect();
  return focusY < rect.top ? nearest.range.start : nearest.range.end;
}

function restoreScrollToTimestamp(
  container: HTMLElement,
  timestamp: number,
  focusOffset: number,
): boolean {
  const elements = getTimelineRangeElements(container);
  let nearest: {
    element: HTMLElement;
    distance: number;
    range: { start: number; end: number };
  } | null = null;

  for (const element of elements) {
    const range = getElementTimeRange(element);
    if (!range) {
      continue;
    }

    if (timestamp >= range.start && timestamp < range.end) {
      const ratio = Math.max(
        0,
        Math.min(1, (timestamp - range.start) / (range.end - range.start)),
      );
      container.scrollTop = element.offsetTop + element.offsetHeight * ratio - focusOffset;
      return true;
    }

    const distance = Math.min(
      Math.abs(timestamp - range.start),
      Math.abs(timestamp - range.end),
    );
    if (!nearest || distance < nearest.distance) {
      nearest = { element, distance, range };
    }
  }

  if (!nearest) {
    return false;
  }

  const useEnd = timestamp > nearest.range.end;
  container.scrollTop =
    nearest.element.offsetTop +
    (useEnd ? nearest.element.offsetHeight : 0) -
    focusOffset;
  return true;
}

function getTouchDistance(touches: PinchTouchList): number {
  const first = touches[0];
  const second = touches[1];
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
}

function getTouchCenterY(touches: PinchTouchList): number {
  return (touches[0].clientY + touches[1].clientY) / 2;
}

function formatVisitDateRange(visit: Visit): string {
  const start = parseDate(visit.start_time);
  const end = parseDate(visit.end_time);

  if (!start || !end) {
    return `${visit.start_time} to ${visit.end_time}`;
  }

  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();

  const startLabel = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  }).format(start);
  const endLabel = new Intl.DateTimeFormat(undefined, {
    month: sameMonth ? undefined : "short",
    day: "numeric",
    year: "numeric",
  }).format(end);

  return `${startLabel}-${endLabel}`;
}
