import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  labelMembers,
  parseSubmissionDate,
  parseTimelineTable,
  parseProseTimeline,
  parseTimelines,
  ALL_CATEGORY_STAMPS,
} from '../scripts/lib/parse.ts';

const tableHtml = `
<html><body>
<table id="tablepress-19">
  <thead><tr><th>Stamp Category</th><th>Submission Date*</th></tr></thead>
  <tbody>
    <tr><td class="column-1">1, 1H</td><td class="column-2">21/07/26</td></tr>
    <tr><td class="column-1">1G</td><td class="column-2">05/05/26</td></tr>
    <tr><td class="column-1">2, 2A, 1A</td><td class="column-2">02/05/26</td></tr>
    <tr><td class="column-1">4</td><td class="column-2">21/03/26</td></tr>
    <tr><td class="column-1">All other categories</td><td class="column-2">12/05/26</td></tr>
  </tbody>
</table>
</body></html>`;

const proseHtml = `<html><body><div><h2>Current Processing Timelines</h2>
<p>We are currently processing applications for renewal submitted on <strong>29/10/2025</strong>
(Note: some applications may still be worked on).</p></div></body></html>`;

const proseWeekHtml = `<html><body><p>Immigration Service Delivery (ISD) are currently processing
applications for renewal submitted from week starting 11/09/2025.</p></body></html>`;

const challengeHtml = '<html><head><title>Just a moment...</title></head><body></body></html>';

test('parses the per-category table', () => {
  const rows = parseTimelineTable(tableHtml);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows[0], { label: '1, 1H', members: ['1', '1H'], date: '2026-07-21' });
  assert.deepEqual(rows[2].members, ['2', '2A', '1A']);
  assert.deepEqual(rows[4], {
    label: 'All other categories',
    members: ['OTHER'],
    date: '2026-05-12',
  });
});

test('ignores unrelated tables and challenge pages', () => {
  assert.deepEqual(parseTimelineTable('<table><tr><td>hi</td></tr></table>'), []);
  assert.deepEqual(parseTimelines(challengeHtml), []);
});

test('parses the older single-date sentence for all categories', () => {
  const rows = parseProseTimeline(proseHtml);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, '2025-10-29');
  assert.deepEqual(rows[0].members, ALL_CATEGORY_STAMPS);
});

test('parses the "week starting" phrasing', () => {
  assert.equal(parseProseTimeline(proseWeekHtml)[0].date, '2025-09-11');
});

test('prefers the table over the prose fallback', () => {
  assert.equal(parseTimelines(tableHtml + proseHtml).length, 5);
});

test('normalises labels into stamp members', () => {
  assert.deepEqual(labelMembers('Stamp 1, 1H'), ['1', '1H']);
  assert.deepEqual(labelMembers(' 2 / 2A '), ['2', '2A']);
  assert.deepEqual(labelMembers('All Other Categories'), ['OTHER']);
  assert.deepEqual(labelMembers('nonsense'), []);
});

test('parses dates and rejects invalid ones', () => {
  assert.equal(parseSubmissionDate('05/05/26'), '2026-05-05');
  assert.equal(parseSubmissionDate('29/10/2025'), '2025-10-29');
  assert.equal(parseSubmissionDate('31/02/26'), null);
  assert.equal(parseSubmissionDate('not a date'), null);
});
