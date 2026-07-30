import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Dataset } from './collect.ts';
import {
  paceOverWindow,
  daysBetween,
  type SeriesPoint,
  type StampSeries,
  type Timeline,
  type TimelineGroup,
} from '../src/lib/timeline.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IN_FILE = path.join(ROOT, 'data', 'observations.json');
const OUT_FILE = path.join(ROOT, 'public', 'data', 'timeline.json');

/** Build one step-function series per individual stamp code across all snapshots. */
export function buildTimeline(dataset: Dataset, nowIso = new Date().toISOString()): Timeline {
  const snapshots = [...dataset.snapshots].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  if (snapshots.length === 0) throw new Error('No observations to derive from.');

  const raw = new Map<string, SeriesPoint[]>();
  const labels = new Map<string, string>();

  for (const snapshot of snapshots) {
    for (const row of snapshot.rows) {
      for (const stamp of row.members) {
        if (!raw.has(stamp)) raw.set(stamp, []);
        raw.get(stamp)!.push({ observedAt: snapshot.observedAt, date: row.date });
        labels.set(stamp, row.label);
      }
    }
  }

  const stamps: StampSeries[] = [];
  for (const [stamp, observations] of raw) {
    // Keep the first observation of each distinct value, plus the final observation.
    const points: SeriesPoint[] = [];
    observations.forEach((point, index) => {
      const isLast = index === observations.length - 1;
      if (points.length === 0 || points[points.length - 1].date !== point.date || isLast) {
        points.push(point);
      }
    });

    const current = points[points.length - 1];
    const advances = points.filter(
      (point, index) => index > 0 && point.date !== points[index - 1].date,
    );
    const lastAdvanceAt = advances.length > 0 ? advances[advances.length - 1].observedAt : null;

    stamps.push({
      stamp,
      label: labels.get(stamp)!,
      current,
      first: points[0],
      points,
      lastAdvanceAt,
      daysSinceAdvance: lastAdvanceAt ? daysBetween(lastAdvanceAt, nowIso) : null,
      pace: {
        d30: paceOverWindow(points, 30, nowIso),
        d90: paceOverWindow(points, 90, nowIso),
        all: paceOverWindow(points, null, nowIso),
      },
    });
  }

  stamps.sort((a, b) => (a.stamp === 'OTHER' ? 1 : b.stamp === 'OTHER' ? -1 : a.stamp.localeCompare(b.stamp, undefined, { numeric: true })));

  const latest = snapshots[snapshots.length - 1];
  const groups: TimelineGroup[] = latest.rows.map((row) => ({
    label: row.label,
    stamps: row.members,
    date: row.date,
    observedAt: latest.observedAt,
  }));

  return {
    generatedAt: nowIso,
    sourceUrl: dataset.sourceUrl,
    latestObservedAt: latest.observedAt,
    observationCount: snapshots.length,
    groups,
    stamps,
  };
}

async function main(): Promise<void> {
  const dataset = JSON.parse(await readFile(IN_FILE, 'utf8')) as Dataset;
  const timeline = buildTimeline(dataset);
  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, `${JSON.stringify(timeline, null, 2)}\n`);
  console.log(
    `Derived ${timeline.stamps.length} stamp series from ${timeline.observationCount} observations.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
