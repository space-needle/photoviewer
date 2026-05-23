import type { CSSProperties } from "react";

import type { TimelineBucket } from "../../lib/api";

type OverviewTimelineProps = {
  buckets: TimelineBucket[];
  onYearSelect?: (year: number) => void;
};

type MonthDensity = {
  key: string;
  year: number;
  month: number;
  photoCount: number;
};

export function OverviewTimeline(props: OverviewTimelineProps) {
  const months = buildMonthDensities(props.buckets);
  const years = Array.from(new Set(months.map((month) => month.year)));

  if (months.length === 0) {
    return null;
  }

  const cap = getDensityCap(months.map((month) => month.photoCount));

  return (
    <section className="overviewTimeline" aria-label="Overview timeline">
      <div className="overviewTimelineHeader">
        <p className="sectionLabel">Overview</p>
        <span>Ambient photo density by month</span>
      </div>
      <div className="overviewTimelineScroller">
        <div className="overviewTimelineRows">
          <div className="overviewYearHitLayer" aria-label="Select year">
            {years.map((year) => (
              <button
                key={year}
                type="button"
                className="overviewYearButton"
                style={
                  {
                    gridRow: `${getYearStartRow(months, year)} / span ${getYearMonthCount(months, year)}`,
                  } as CSSProperties
                }
                onClick={() => props.onYearSelect?.(year)}
              >
                <span className="srOnly">Open {year} detail timeline</span>
              </button>
            ))}
          </div>
          {months.map((month) => {
            const intensity = getDensityIntensity(month.photoCount, cap);
            const isYearStart = month.month === 1;

            return (
              <div
                key={month.key}
                className={isYearStart ? "overviewMonthRow yearStart" : "overviewMonthRow"}
              >
                <div className="overviewYearLabel">
                  {isYearStart ? <span>{month.year}</span> : null}
                </div>
                <div
                  className="overviewDensitySegment"
                  style={
                    {
                      "--overview-intensity": intensity.toFixed(3),
                    } as CSSProperties
                  }
                  title={`${formatMonthLabel(month)}: ${formatPhotoCount(month.photoCount)}`}
                />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function buildMonthDensities(buckets: TimelineBucket[]): MonthDensity[] {
  const firstDate = parseDate(buckets[0]?.bucket_start ?? "");
  const lastEndDate = parseDate(buckets[buckets.length - 1]?.bucket_end ?? "");

  if (!firstDate || !lastEndDate) {
    return [];
  }

  const countsByMonth = new Map<string, number>();
  buckets.forEach((bucket) => {
    const date = parseDate(bucket.bucket_start);
    if (!date) {
      return;
    }

    const key = getMonthKey(date);
    countsByMonth.set(key, (countsByMonth.get(key) ?? 0) + bucket.photo_count);
  });

  const months: MonthDensity[] = [];
  const cursor = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
  const finalMonth = new Date(lastEndDate);
  finalMonth.setDate(finalMonth.getDate() - 1);
  finalMonth.setDate(1);

  while (cursor <= finalMonth) {
    const key = getMonthKey(cursor);
    months.push({
      key,
      year: cursor.getFullYear(),
      month: cursor.getMonth() + 1,
      photoCount: countsByMonth.get(key) ?? 0,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return months;
}

function getDensityCap(counts: number[]): number {
  const nonZeroCounts = counts.filter((count) => count > 0).sort((left, right) => left - right);
  if (nonZeroCounts.length === 0) {
    return 1;
  }

  const percentileIndex = Math.min(
    nonZeroCounts.length - 1,
    Math.floor(nonZeroCounts.length * 0.9),
  );
  return Math.max(1, nonZeroCounts[percentileIndex]);
}

function getDensityIntensity(photoCount: number, cap: number): number {
  if (photoCount <= 0) {
    return 0;
  }

  return Math.min(1, Math.log1p(photoCount) / Math.log1p(cap));
}

function getYearStartRow(months: MonthDensity[], year: number): number {
  const index = months.findIndex((month) => month.year === year);
  return index < 0 ? 1 : index + 1;
}

function getYearMonthCount(months: MonthDensity[], year: number): number {
  return Math.max(1, months.filter((month) => month.year === year).length);
}

function parseDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(month: MonthDensity): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    year: "numeric",
  }).format(new Date(month.year, month.month - 1, 1));
}

function formatPhotoCount(count: number): string {
  return count === 1 ? "1 photo" : `${count} photos`;
}
