import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline } from '../scripts/derive.ts';
import type { Dataset } from '../scripts/collect.ts';
import {
  addBusinessDays,
  estimate,
  paceOverWindow,
  seriesForStamp,
  valueAt,
  toTime,
  type SeriesPoint,
  type StampSeries,
} from '../src/lib/timeline.ts';

const points: SeriesPoint[] = [
  { observedAt: '2026-01-01T00:00:00Z', date: '2025-10-01' },
  { observedAt: '2026-02-01T00:00:00Z', date: '2025-11-01' },
  { observedAt: '2026-03-01T00:00:00Z', date: '2025-12-01' },
];

const makeSeries = (overrides: Partial<StampSeries> = {}): StampSeries => ({
  stamp: '4',
  label: '4',
  first: points[0],
  current: points[points.length - 1],
  points,
  lastAdvanceAt: '2026-03-01T00:00:00Z',
  daysSinceAdvance: 0,
  pace: {
    d30: { rate: 1, spanDays: 30, observations: 3 },
    d90: { rate: 1, spanDays: 90, observations: 5 },
    all: { rate: 0.5, spanDays: 120, observations: 8 },
  },
  ...overrides,
});

test('valueAt reads the step function', () => {
  assert.equal(valueAt(points, toTime('2025-12-31T00:00:00Z')), null);
  assert.equal(valueAt(points, toTime('2026-01-15T00:00:00Z')), '2025-10-01');
  assert.equal(valueAt(points, toTime('2026-09-01T00:00:00Z')), '2025-12-01');
});

test('pace measures backlog days cleared per calendar day', () => {
  const all = paceOverWindow(points, null, '2026-03-01T00:00:00Z');
  // 61 submission days cleared over 59 calendar days.
  assert.ok(all);
  assert.ok(Math.abs(all.rate - 61 / 59) < 1e-9);

  // The 30-day window contains the Feb and Mar observations: 30 submission days over 28 days.
  const recent = paceOverWindow(points, 30, '2026-03-01T00:00:00Z');
  assert.ok(recent);
  assert.equal(recent.observations, 2);
  assert.ok(Math.abs(recent.rate - 30 / 28) < 1e-9);
});

test('pace ignores windows containing a single observation after a sparse gap', () => {
  // A four-month gap followed by one fresh observation must not be read as a 30-day burst.
  const sparse: SeriesPoint[] = [
    { observedAt: '2026-01-20T00:00:00Z', date: '2025-10-31' },
    { observedAt: '2026-05-18T00:00:00Z', date: '2026-02-09' },
  ];
  assert.equal(paceOverWindow(sparse, 30, '2026-05-18T00:00:00Z'), null);

  const overall = paceOverWindow(sparse, null, '2026-05-18T00:00:00Z');
  assert.ok(overall);
  // 101 submission days over the real 118-day span, not over 30 days.
  assert.ok(Math.abs(overall.rate - 101 / 118) < 1e-9);
});

test('pace returns null for too-short windows or single points', () => {
  assert.equal(paceOverWindow(points, 3, '2026-03-01T00:00:00Z'), null);
  assert.equal(paceOverWindow([points[0]], null, '2026-03-01T00:00:00Z'), null);
});

test('estimate flags dates already reached', () => {
  const result = estimate(makeSeries(), '2025-11-15T12:00:00Z');
  assert.equal(result.status, 'reached');
  assert.ok(result.gapDays < 0);
});

test('estimate projects an ETA with a range', () => {
  const series = makeSeries();
  const result = estimate(series, '2026-01-01T00:00:00Z', '2026-03-01T00:00:00Z');
  assert.equal(result.status, 'estimated');
  assert.equal(result.gapDays, 31);
  // Central uses the most recent window's rate of 1 d/day from the current observation.
  assert.equal(result.central!.etaIso.slice(0, 10), '2026-04-01');
  // Pessimistic uses the slowest positive rate (0.5 d/day) → twice as long.
  assert.equal(result.pessimistic!.etaIso.slice(0, 10), '2026-05-02');
  assert.ok(toTime(result.optimistic!.etaIso) <= toTime(result.central!.etaIso));
  assert.ok(toTime(result.cardIso!) > toTime(result.central!.etaIso));
});

test('estimate never returns a scenario date in the past', () => {
  const series = makeSeries({
    pace: {
      d30: { rate: 5, spanDays: 30, observations: 4 },
      d90: null,
      all: { rate: 5, spanDays: 90, observations: 8 },
    },
  });
  // The current observation is old and the queue is fast, so the raw projection lands in the past.
  const now = '2026-06-01T00:00:00Z';
  const result = estimate(series, '2026-01-01T00:00:00Z', now);
  assert.equal(result.status, 'estimated');
  for (const scenario of [result.optimistic!, result.central!, result.pessimistic!]) {
    assert.ok(toTime(scenario.etaIso) >= toTime(now));
  }
});

test('estimate reports stalls and missing history', () => {
  const stalled = estimate(
    makeSeries({
      pace: {
        d30: { rate: 0, spanDays: 30, observations: 3 },
        d90: null,
        all: { rate: 0, spanDays: 90, observations: 5 },
      },
    }),
    '2026-01-01T00:00:00Z',
  );
  assert.equal(stalled.status, 'stalled');

  const sparse = estimate(
    makeSeries({ pace: { d30: null, d90: null, all: null } }),
    '2026-01-01T00:00:00Z',
  );
  assert.equal(sparse.status, 'insufficient-data');
});

test('addBusinessDays skips weekends', () => {
  // 2026-03-05 is a Thursday; +15 business days lands on 2026-03-26 (Thursday).
  assert.equal(addBusinessDays('2026-03-05T00:00:00Z', 15).slice(0, 10), '2026-03-26');
});

const dataset: Dataset = {
  sourceUrl: 'https://example.test/',
  generatedAt: '2026-03-02T00:00:00Z',
  checked: [],
  snapshots: [
    {
      timestamp: '20260101000000',
      observedAt: '2026-01-01T00:00:00Z',
      rows: [{ label: 'All categories', members: ['1', '4', 'OTHER'], date: '2025-10-01' }],
    },
    {
      timestamp: '20260201000000',
      observedAt: '2026-02-01T00:00:00Z',
      rows: [
        { label: '1', members: ['1'], date: '2025-12-01' },
        { label: '4', members: ['4'], date: '2025-11-01' },
        { label: 'All other categories', members: ['OTHER'], date: '2025-11-15' },
      ],
    },
    {
      timestamp: '20260301000000',
      observedAt: '2026-03-01T00:00:00Z',
      rows: [
        { label: '1', members: ['1'], date: '2025-12-15' },
        { label: '4', members: ['4'], date: '2025-11-01' },
        { label: 'All other categories', members: ['OTHER'], date: '2025-12-01' },
      ],
    },
  ],
};

test('buildTimeline stitches regrouped categories into per-stamp series', () => {
  const timeline = buildTimeline(dataset, '2026-03-02T00:00:00Z');
  assert.equal(timeline.stamps.length, 3);

  const stamp1 = timeline.stamps.find((s) => s.stamp === '1')!;
  assert.equal(stamp1.first.date, '2025-10-01');
  assert.equal(stamp1.current.date, '2025-12-15');
  assert.equal(stamp1.points.length, 3);

  const stamp4 = timeline.stamps.find((s) => s.stamp === '4')!;
  // Stalled since February: the last point repeats the previous value as the latest observation.
  assert.equal(stamp4.lastAdvanceAt, '2026-02-01T00:00:00Z');
  assert.ok(stamp4.daysSinceAdvance! > 28);

  assert.equal(timeline.groups.length, 3);
  assert.equal(timeline.latestObservedAt, '2026-03-01T00:00:00Z');
});

test('seriesForStamp falls back to the catch-all category', () => {
  const timeline = buildTimeline(dataset, '2026-03-02T00:00:00Z');
  assert.equal(seriesForStamp(timeline, '4')!.stamp, '4');
  assert.equal(seriesForStamp(timeline, '5')!.stamp, 'OTHER');
});
