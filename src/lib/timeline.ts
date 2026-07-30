export interface SeriesPoint {
  /** When the value was observed (ISO datetime). */
  observedAt: string;
  /** Submission date being processed at that time (ISO yyyy-mm-dd). */
  date: string;
}

export interface Pace {
  /** Backlog days cleared per calendar day. */
  rate: number;
  /** Calendar days actually covered by the window. */
  spanDays: number;
}

export interface StampSeries {
  /** Stamp code, e.g. "1", "1H", or "OTHER" for the catch-all row. */
  stamp: string;
  /** Most recent published label covering this stamp. */
  label: string;
  current: SeriesPoint;
  first: SeriesPoint;
  /** Step-function points: first observation of each new value, plus the latest observation. */
  points: SeriesPoint[];
  lastAdvanceAt: string | null;
  daysSinceAdvance: number | null;
  pace: {
    d30: Pace | null;
    d90: Pace | null;
    all: Pace | null;
  };
}

export interface TimelineGroup {
  label: string;
  stamps: string[];
  date: string;
  observedAt: string;
}

export interface Timeline {
  generatedAt: string;
  sourceUrl: string;
  latestObservedAt: string;
  observationCount: number;
  groups: TimelineGroup[];
  stamps: StampSeries[];
}

export const DAY_MS = 86_400_000;

export const toTime = (iso: string): number => new Date(iso).getTime();

export const daysBetween = (fromIso: string, toIso: string): number =>
  (toTime(toIso) - toTime(fromIso)) / DAY_MS;

export const addDays = (iso: string, days: number): string =>
  new Date(toTime(iso) + days * DAY_MS).toISOString();

/** Value of the step function at time `at`; null if `at` predates the series. */
export function valueAt(points: SeriesPoint[], at: number): string | null {
  let value: string | null = null;
  for (const point of points) {
    if (toTime(point.observedAt) <= at) value = point.date;
    else break;
  }
  return value;
}

/**
 * Backlog days cleared per calendar day over the trailing `windowDays`.
 * Returns null when the window is too short to be meaningful.
 */
export function paceOverWindow(
  points: SeriesPoint[],
  windowDays: number | null,
  nowIso: string,
  minSpanDays = 7,
): Pace | null {
  if (points.length < 2) return null;
  const now = toTime(nowIso);
  const seriesStart = toTime(points[0].observedAt);
  const start = windowDays === null ? seriesStart : Math.max(now - windowDays * DAY_MS, seriesStart);
  const end = Math.min(now, toTime(points[points.length - 1].observedAt));
  const spanDays = (end - start) / DAY_MS;
  if (spanDays < minSpanDays) return null;

  const startValue = valueAt(points, start);
  const endValue = valueAt(points, end);
  if (!startValue || !endValue) return null;

  const cleared = daysBetween(startValue, endValue);
  return { rate: cleared / spanDays, spanDays };
}

export type EstimateStatus = 'reached' | 'estimated' | 'stalled' | 'insufficient-data';

export interface Estimate {
  status: EstimateStatus;
  /** Backlog days between the processed-up-to date and the user's submission date. */
  gapDays: number;
  central?: { etaIso: string; days: number; rate: number };
  optimistic?: { etaIso: string; days: number; rate: number };
  pessimistic?: { etaIso: string; days: number; rate: number };
  /** Central ETA plus 15 business days for the card to arrive by post. */
  cardIso?: string;
}

/** Add business days (Mon–Fri), ignoring public holidays. */
export function addBusinessDays(iso: string, count: number): string {
  const date = new Date(toTime(iso));
  let added = 0;
  while (added < count) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) added++;
  }
  return date.toISOString();
}

/**
 * Estimate when an application submitted on `submissionDate` will be reached.
 * Projection starts from the moment the current value was observed, since the gap is
 * measured at that moment.
 */
export function estimate(series: StampSeries, submissionDate: string): Estimate {
  const gapDays = daysBetween(series.current.date, submissionDate);
  if (gapDays <= 0) return { status: 'reached', gapDays };

  const rates = [series.pace.d30, series.pace.d90, series.pace.all]
    .filter((p): p is Pace => p !== null)
    .map((p) => p.rate);

  if (rates.length === 0) return { status: 'insufficient-data', gapDays };

  const positive = rates.filter((rate) => rate > 0);
  if (positive.length === 0) return { status: 'stalled', gapDays };

  const centralRate = (series.pace.d90 ?? series.pace.all ?? series.pace.d30)!.rate;
  const project = (rate: number) => {
    const days = gapDays / rate;
    return { etaIso: addDays(series.current.observedAt, days), days, rate };
  };

  const central = project(centralRate > 0 ? centralRate : Math.max(...positive));
  const optimistic = project(Math.max(...positive));
  const pessimistic = project(Math.min(...positive));

  return {
    status: 'estimated',
    gapDays,
    central,
    optimistic,
    pessimistic,
    cardIso: addBusinessDays(central.etaIso, 15),
  };
}

/** Find the series that covers a stamp, falling back to the catch-all row. */
export function seriesForStamp(timeline: Timeline, stamp: string): StampSeries | undefined {
  return (
    timeline.stamps.find((s) => s.stamp === stamp) ??
    timeline.stamps.find((s) => s.stamp === 'OTHER')
  );
}
