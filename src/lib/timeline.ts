export interface SeriesPoint {
  /** When the value was observed (ISO datetime). */
  observedAt: string;
  /** Submission date being processed at that time (ISO yyyy-mm-dd). */
  date: string;
}

export interface Pace {
  /** Backlog days cleared per calendar day. */
  rate: number;
  /** Calendar days between the two observations used. */
  spanDays: number;
  /** How many observations the window contained. */
  observations: number;
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
  /** When ISD started publishing per-category dates; before this there was one shared queue. */
  categorySplitAt: string | null;
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
 * Backlog days cleared per calendar day over the trailing `windowDays`, measured between two
 * *actual observations* inside the window.
 *
 * Using observed endpoints matters: the archive has sparse monthly snapshots before 2026 and
 * dense daily ones after. Interpolating from the window's start instant would credit an advance
 * that accrued over several months to a 30-day window, inflating the rate several-fold.
 */
export function paceOverWindow(
  points: SeriesPoint[],
  windowDays: number | null,
  nowIso: string,
  minSpanDays = 7,
): Pace | null {
  if (points.length < 2) return null;
  const now = toTime(nowIso);
  const start = windowDays === null ? -Infinity : now - windowDays * DAY_MS;

  const inWindow = points.filter((point) => {
    const at = toTime(point.observedAt);
    return at >= start && at <= now;
  });
  if (inWindow.length < 2) return null;

  const first = inWindow[0];
  const last = inWindow[inWindow.length - 1];
  const spanDays = daysBetween(first.observedAt, last.observedAt);
  if (spanDays < minSpanDays) return null;

  return {
    rate: daysBetween(first.date, last.date) / spanDays,
    spanDays,
    observations: inWindow.length,
  };
}

/** How long an application submitted today would wait, in days, at the observed moment. */
export const lagDays = (point: SeriesPoint): number => daysBetween(point.date, point.observedAt);

/**
 * How the wait itself is changing, in days of wait added per calendar day.
 * Positive means the queue is falling further behind; negative means it is catching up.
 */
export const waitTrend = (rate: number): number => 1 - rate;

export type EstimateStatus = 'reached' | 'estimated' | 'stalled' | 'insufficient-data';

export interface Scenario {
  etaIso: string;
  /** Days from the observation the projection starts at. */
  days: number;
  rate: number;
}

export interface Estimate {
  status: EstimateStatus;
  /** Backlog days between the processed-up-to date and the user's submission date. */
  gapDays: number;
  central?: Scenario;
  optimistic?: Scenario;
  pessimistic?: Scenario;
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

/** Never present a window narrower than this share of the projection, or this many days. */
const MIN_MARGIN_FRACTION = 0.25;
const MIN_MARGIN_DAYS = 14;

/**
 * Estimate when an application submitted on `submissionDate` will be reached.
 *
 * The central rate is the most recent window with real observations behind it, because the
 * long-run average is dominated by a period when the queue behaved very differently. The
 * optimistic/pessimistic scenarios are widened to a minimum margin so the result never implies
 * precision the data cannot support.
 */
export function estimate(
  series: StampSeries,
  submissionDate: string,
  nowIso: string = new Date().toISOString(),
): Estimate {
  const gapDays = daysBetween(series.current.date, submissionDate);
  if (gapDays <= 0) return { status: 'reached', gapDays };

  const windows = [series.pace.d30, series.pace.d90, series.pace.all].filter(
    (pace): pace is Pace => pace !== null,
  );
  if (windows.length === 0) return { status: 'insufficient-data', gapDays };

  const rates = windows.map((pace) => pace.rate).filter((rate) => rate > 0);
  if (rates.length === 0) return { status: 'stalled', gapDays };

  const preferred = [series.pace.d30, series.pace.d90, series.pace.all].find(
    (pace) => pace !== null && pace.rate > 0,
  )!;

  // The projection starts at the observation the gap was measured at, which may be days old,
  // so clamp every scenario to today — an ETA in the past is never a useful answer.
  const project = (days: number, rate: number): Scenario => {
    const projected = addDays(series.current.observedAt, days);
    return {
      etaIso: toTime(projected) < toTime(nowIso) ? nowIso : projected,
      days,
      rate,
    };
  };

  const centralDays = gapDays / preferred.rate;
  const margin = Math.max(centralDays * MIN_MARGIN_FRACTION, MIN_MARGIN_DAYS);
  const fastestDays = Math.min(gapDays / Math.max(...rates), centralDays - margin);
  const slowestDays = Math.max(gapDays / Math.min(...rates), centralDays + margin);

  const central = project(centralDays, preferred.rate);

  return {
    status: 'estimated',
    gapDays,
    central,
    optimistic: project(Math.max(fastestDays, 0), gapDays / Math.max(fastestDays, 1)),
    pessimistic: project(slowestDays, gapDays / slowestDays),
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
