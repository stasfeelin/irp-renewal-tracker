import * as cheerio from 'cheerio';

export interface ParsedRow {
  /** Raw label as published, e.g. "1, 1H" or "All other categories". */
  label: string;
  /** Individual stamp codes the label covers, e.g. ["1", "1H"]. "OTHER" for the catch-all row. */
  members: string[];
  /** Submission date currently being processed, ISO yyyy-mm-dd. */
  date: string;
}

export const OTHER = 'OTHER';

/**
 * Stamps covered when ISD published a single queue for everyone (page versions before the
 * per-category table was introduced in 2026).
 */
export const ALL_CATEGORY_STAMPS = ['1', '1H', '1G', '1A', '2', '2A', '4', OTHER];

/** Turn a published label into the individual stamp codes it covers. */
export function labelMembers(label: string): string[] {
  const cleaned = label.replace(/\*/g, '').trim();
  if (/all other/i.test(cleaned)) return [OTHER];
  return cleaned
    .split(/[,/]|\band\b/i)
    .map((part) => part.trim().toUpperCase().replace(/^STAMP\s*/, ''))
    .filter((part) => /^[0-9]+[A-Z]*$/.test(part));
}

/** Parse a DD/MM/YY or DD/MM/YYYY submission date into ISO yyyy-mm-dd. */
export function parseSubmissionDate(raw: string): string | null {
  const match = raw.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * Older page versions had no table, just a sentence naming a single date for all categories.
 * e.g. "We are currently processing applications for renewal submitted on 29/10/2025".
 */
export function parseProseTimeline(html: string): ParsedRow[] {
  const text = cheerio.load(html)('body').text().replace(/\s+/g, ' ');
  const match = text.match(
    /processing applications for renewal submitted[^.]{0,60}?(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/i,
  );
  if (!match) return [];
  const date = parseSubmissionDate(match[1]);
  if (!date) return [];
  return [{ label: 'All categories', members: [...ALL_CATEGORY_STAMPS], date }];
}

/**
 * Extract the published processing timelines from a snapshot of the ISD renewal page, using the
 * per-category table when present and falling back to the older single-date sentence.
 * Returns an empty array when the page has neither (e.g. an archived Cloudflare challenge page).
 */
export function parseTimelines(html: string): ParsedRow[] {
  const rows = parseTimelineTable(html);
  return rows.length > 0 ? rows : parseProseTimeline(html);
}

/**
 * Extract the "Current Processing Timelines" table rows from a snapshot of the ISD renewal page.
 */
export function parseTimelineTable(html: string): ParsedRow[] {
  const $ = cheerio.load(html);

  for (const table of $('table').toArray()) {
    const headers = $(table)
      .find('th')
      .toArray()
      .map((th) => $(th).text().trim().toLowerCase());
    const looksRight =
      headers.some((h) => h.includes('stamp')) && headers.some((h) => h.includes('submission'));
    if (!looksRight) continue;

    const rows: ParsedRow[] = [];
    for (const tr of $(table).find('tbody tr').toArray()) {
      const cells = $(tr)
        .find('td')
        .toArray()
        .map((td) => $(td).text().replace(/\s+/g, ' ').trim());
      if (cells.length < 2) continue;
      const label = cells[0];
      const date = parseSubmissionDate(cells[1]);
      const members = labelMembers(label);
      if (!date || members.length === 0) continue;
      rows.push({ label, members, date });
    }
    if (rows.length > 0) return rows;
  }
  return [];
}
