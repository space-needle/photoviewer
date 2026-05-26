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

type YearDensity = {
  year: number;
  key: string;
  photoCount: number;
  months: MonthDensity[];
};

export function OverviewTimeline(props: OverviewTimelineProps) {
  const months = buildMonthDensities(props.buckets);

  if (months.length === 0) {
    return null;
  }

  const years = buildYearDensities(months);
  const cap = getDensityCap(months.map((month) => month.photoCount));

  return (
    <section className="overviewTimeline" aria-label="Overview timeline">
      <div className="overviewTimelineHeader">
        <p className="sectionLabel">Overview</p>
        <span>Ambient photo density by month</span>
      </div>
      <div className="overviewTimelineScroller">
        <div className="overviewTimelineRows">
          {years.map((yearData) => {
            return (
              <button
                key={yearData.key}
                type="button"
                className="overviewYearRow"
                data-year={yearData.year}
                onClick={() => props.onYearSelect?.(yearData.year)}
                title={`Open ${yearData.year} timeline: ${formatPhotoCount(yearData.photoCount)}`}
              >
                <span className="overviewYearLabel">
                  <span className="overviewYearButton">{yearData.year}</span>
                </span>
                <span className="overviewYearDensity" aria-hidden="true">
                  {yearData.months.map((month) => {
                    const intensity = getDensityIntensity(month.photoCount, cap);

                    return (
                      <span
                        key={month.key}
                        className="overviewDensitySegment"
                        style={
                          {
                            "--overview-intensity": intensity.toFixed(3),
                          } as CSSProperties
                        }
                        title={`${formatMonthLabel(month)}: ${formatPhotoCount(month.photoCount)}`}
                      />
                    );
                  })}
                </span>
                <span className="srOnly">
                  Open {yearData.year} timeline, {formatPhotoCount(yearData.photoCount)}
                </span>
              </button>
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

function buildYearDensities(months: MonthDensity[]): YearDensity[] {
  const yearsByKey = new Map<number, YearDensity>();

  months.forEach((month) => {
    const yearData =
      yearsByKey.get(month.year) ??
      ({
        year: month.year,
        key: String(month.year),
        photoCount: 0,
        months: [],
      } satisfies YearDensity);

    yearData.photoCount += month.photoCount;
    yearData.months.push(month);
    yearsByKey.set(month.year, yearData);
  });

  return Array.from(yearsByKey.values());
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
