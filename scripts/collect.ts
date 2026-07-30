import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTimelines, type ParsedRow } from './lib/parse.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_FILE = path.join(ROOT, 'data', 'observations.json');

export const SOURCE_URL =
  'https://www.irishimmigration.ie/registering-your-immigration-permission/how-to-renew-your-current-permission/renewing-your-registration-permission-if-you-live-in-the-republic-of-ireland/';
const CDX_URL = 'https://web.archive.org/cdx/search/cdx';
const USER_AGENT = 'irp-renewal-tracker (+https://github.com/, open-source, polite)';

export interface Snapshot {
  /** Wayback timestamp, yyyymmddhhmmss. */
  timestamp: string;
  /** Snapshot capture time, ISO. */
  observedAt: string;
  rows: ParsedRow[];
}

export interface Dataset {
  sourceUrl: string;
  generatedAt: string;
  /** Timestamps already fetched, including ones with no usable table (so we do not refetch). */
  checked: string[];
  snapshots: Snapshot[];
}

const emptyDataset = (): Dataset => ({
  sourceUrl: SOURCE_URL,
  generatedAt: new Date().toISOString(),
  checked: [],
  snapshots: [],
});

export function waybackTimestampToIso(timestamp: string): string {
  const [, y, mo, d, h, mi, s] =
    timestamp.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/) ?? [];
  if (!y) throw new Error(`Bad Wayback timestamp: ${timestamp}`);
  return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
}

async function loadDataset(): Promise<Dataset> {
  try {
    return JSON.parse(await readFile(DATA_FILE, 'utf8')) as Dataset;
  } catch {
    return emptyDataset();
  }
}

async function fetchWithRetry(url: string, attempts = 4): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(2000 * 2 ** (attempt - 1));
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': USER_AGENT, 'accept-encoding': 'gzip' },
        signal: AbortSignal.timeout(60_000),
      });
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wayback `id_` replay returns the original bytes, which are often still gzipped. */
async function readBody(response: Response): Promise<string> {
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) return gunzipSync(buffer).toString('utf8');
  return buffer.toString('utf8');
}

export async function listSnapshots(limit?: number): Promise<string[]> {
  const params = new URLSearchParams({
    url: SOURCE_URL.replace(/^https?:\/\//, ''),
    output: 'json',
    fl: 'timestamp,statuscode',
    filter: 'statuscode:200',
  });
  if (limit) params.set('limit', String(-Math.abs(limit)));
  const response = await fetchWithRetry(`${CDX_URL}?${params}`);
  const rows = JSON.parse(await response.text()) as string[][];
  return rows.slice(1).map((row) => row[0]);
}

async function fetchSnapshot(timestamp: string): Promise<ParsedRow[]> {
  const response = await fetchWithRetry(`https://web.archive.org/web/${timestamp}id_/${SOURCE_URL}`);
  if (!response.ok) return [];
  return parseTimelines(await readBody(response));
}

/** Best-effort request for a fresh capture of the live page. Never fatal. */
async function requestFreshCapture(): Promise<void> {
  try {
    await fetch(`https://web.archive.org/save/${SOURCE_URL}`, {
      headers: { 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(120_000),
    });
    console.log('Requested a fresh Wayback capture.');
    await sleep(15_000);
  } catch (error) {
    console.warn('Fresh capture request failed (ignored):', (error as Error).message);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : undefined;

  if (args.includes('--save')) await requestFreshCapture();

  const dataset = await loadDataset();
  if (args.includes('--recheck')) dataset.checked = [];
  const checked = new Set(dataset.checked);
  const known = new Set(dataset.snapshots.map((s) => s.timestamp));

  const timestamps = await listSnapshots(limit);
  const pending = timestamps.filter((ts) => !checked.has(ts) && !known.has(ts));
  console.log(`${timestamps.length} snapshots listed, ${pending.length} new to fetch.`);

  let added = 0;
  for (const [index, timestamp] of pending.entries()) {
    try {
      const rows = await fetchSnapshot(timestamp);
      checked.add(timestamp);
      if (rows.length > 0) {
        known.add(timestamp);
        dataset.snapshots.push({
          timestamp,
          observedAt: waybackTimestampToIso(timestamp),
          rows,
        });
        added++;
        console.log(`[${index + 1}/${pending.length}] ${timestamp}: ${rows.length} rows`);
      } else {
        console.log(`[${index + 1}/${pending.length}] ${timestamp}: no table (skipped)`);
      }
    } catch (error) {
      // Leave the timestamp unchecked so a later run retries it.
      console.warn(`[${index + 1}/${pending.length}] ${timestamp}: ${(error as Error).message}`);
    }
    await sleep(1200);
  }

  dataset.sourceUrl = SOURCE_URL;
  dataset.checked = [...checked].sort();
  dataset.snapshots.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  dataset.generatedAt = new Date().toISOString();

  await mkdir(path.dirname(DATA_FILE), { recursive: true });
  await writeFile(DATA_FILE, `${JSON.stringify(dataset, null, 2)}\n`);
  console.log(`Added ${added} observations; ${dataset.snapshots.length} total.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
