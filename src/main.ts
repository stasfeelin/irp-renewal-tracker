import Chart from 'chart.js/auto';
import {
  estimate,
  paceOverWindow,
  seriesForStamp,
  toTime,
  type StampSeries,
  type Timeline,
} from './lib/timeline.ts';

const STAMP_OPTIONS: Array<{ value: string; text: string }> = [
  { value: '1', text: 'Stamp 1' },
  { value: '1A', text: 'Stamp 1A' },
  { value: '1G', text: 'Stamp 1G' },
  { value: '1H', text: 'Stamp 1H' },
  { value: '2', text: 'Stamp 2' },
  { value: '2A', text: 'Stamp 2A' },
  { value: '3', text: 'Stamp 3' },
  { value: '4', text: 'Stamp 4' },
  { value: '5', text: 'Stamp 5' },
  { value: '6', text: 'Stamp 6' },
  { value: 'OTHER', text: 'Other / not listed' },
];

const COLOURS = ['#2fb98d', '#4c9be8', '#e0a44a', '#e2748a', '#a78bfa', '#4dd0e1', '#f2f2f2'];

const $ = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
};

const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-IE', { day: '2-digit', month: 'short', year: 'numeric' });

const fmtDays = (days: number): string => {
  const rounded = Math.round(days);
  if (rounded < 14) return `${rounded} day${rounded === 1 ? '' : 's'}`;
  if (rounded < 70) return `${Math.round(days / 7)} weeks`;
  return `${Math.round((days / 365) * 12)} months`;
};

const paceClass = (rate: number | undefined): string =>
  rate === undefined ? 'pace-none' : rate >= 1 ? 'pace-good' : rate > 0 ? 'pace-slow' : 'pace-none';

const fmtPace = (rate: number | undefined): string =>
  rate === undefined ? '—' : `${rate.toFixed(2)} d/day`;

/** Unique series (grouped stamps share one series object's data). */
function distinctSeries(timeline: Timeline): StampSeries[] {
  const seen = new Set<string>();
  return timeline.stamps.filter((series) => {
    if (seen.has(series.label)) return false;
    seen.add(series.label);
    return true;
  });
}

function renderStatus(timeline: Timeline): void {
  const staleDays = (Date.now() - toTime(timeline.latestObservedAt)) / 86_400_000;
  $('#freshness').textContent =
    `Last checked ${fmtDate(timeline.latestObservedAt)} (${fmtDays(staleDays)} ago) · ` +
    `${timeline.observationCount} observations since ${fmtDate(timeline.stamps[0].first.observedAt)}`;

  const body = $('#status-table tbody');
  body.innerHTML = '';
  for (const group of timeline.groups) {
    const series = timeline.stamps.find((s) => s.stamp === group.stamps[0]);
    const row = document.createElement('tr');
    const advance = series?.lastAdvanceAt
      ? `${fmtDate(series.lastAdvanceAt)} (${fmtDays(series.daysSinceAdvance ?? 0)} ago)`
      : '—';
    row.innerHTML = `
      <td>${group.label}</td>
      <td><strong>${fmtDate(group.date)}</strong></td>
      <td>${advance}</td>
      <td class="${paceClass(series?.pace.d30?.rate)}">${fmtPace(series?.pace.d30?.rate)}</td>
      <td class="${paceClass(series?.pace.d90?.rate)}">${fmtPace(series?.pace.d90?.rate)}</td>`;
    body.appendChild(row);
  }
}

function renderEstimator(timeline: Timeline): void {
  const select = $<HTMLSelectElement>('#stamp-select');
  select.innerHTML = '';
  for (const option of STAMP_OPTIONS) {
    const element = document.createElement('option');
    element.value = option.value;
    const series = seriesForStamp(timeline, option.value);
    element.textContent =
      series && series.stamp !== option.value && option.value !== 'OTHER'
        ? `${option.text} (in "${series.label}")`
        : option.text;
    select.appendChild(element);
  }
  select.value = '4';

  const input = $<HTMLInputElement>('#submitted-input');
  input.max = new Date().toISOString().slice(0, 10);

  $('#estimate-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const series = seriesForStamp(timeline, select.value);
    const result = $<HTMLDivElement>('#estimate-result');
    result.hidden = false;

    if (!series) {
      result.innerHTML = '<p class="error">No data available for that stamp category yet.</p>';
      return;
    }

    const submitted = `${input.value}T12:00:00Z`;
    const outcome = estimate(series, submitted);
    const context = `<p class="muted">Category "${series.label}" was processing applications from
      <strong>${fmtDate(series.current.date)}</strong> as of ${fmtDate(series.current.observedAt)}.</p>`;

    if (outcome.status === 'reached') {
      result.innerHTML = `<p class="headline good">Your date has already been reached</p>
        <p>Applications submitted on ${fmtDate(submitted)} are ${fmtDays(-outcome.gapDays)}
        inside the processed window, so yours should be decided already or imminently.</p>${context}`;
      return;
    }
    if (outcome.status === 'stalled') {
      result.innerHTML = `<p class="headline warn">No measurable movement</p>
        <p>This category has not advanced recently, so no meaningful estimate can be made.
        You are ${fmtDays(outcome.gapDays)} of submissions behind the current front.</p>${context}`;
      return;
    }
    if (outcome.status === 'insufficient-data') {
      result.innerHTML = `<p class="headline warn">Not enough history yet</p>
        <p>There is too little recorded history for this category to estimate a pace.</p>${context}`;
      return;
    }

    const { central, optimistic, pessimistic, cardIso } = outcome;
    result.innerHTML = `
      <p class="headline">≈ ${fmtDate(central!.etaIso)}</p>
      <p>That is roughly <strong>${fmtDays(
        (toTime(central!.etaIso) - Date.now()) / 86_400_000,
      )}</strong> from today, clearing a backlog of ${fmtDays(outcome.gapDays)} of submissions
      at ${central!.rate.toFixed(2)} days per day.</p>
      <div class="range">
        <div><span>Optimistic</span><strong>${fmtDate(optimistic!.etaIso)}</strong></div>
        <div><span>Central estimate</span><strong>${fmtDate(central!.etaIso)}</strong></div>
        <div><span>Pessimistic</span><strong>${fmtDate(pessimistic!.etaIso)}</strong></div>
        <div><span>Card by post (+15 business days)</span><strong>${fmtDate(cardIso!)}</strong></div>
      </div>
      ${context}
      <p class="muted">The range comes from the 30-day, 90-day and all-time pace of this category.
      Pace changes; treat this as a rough guide, not a promise.</p>`;
  });
}

/** Step-function data expanded so lines are drawn as horizontal-then-vertical steps. */
function stepData(series: StampSeries): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  series.points.forEach((point, index) => {
    if (index > 0) points.push({ x: toTime(point.observedAt), y: toTime(series.points[index - 1].date) });
    points.push({ x: toTime(point.observedAt), y: toTime(point.date) });
  });
  return points;
}

function renderHistoryChart(timeline: Timeline): void {
  const seriesList = distinctSeries(timeline);
  const datasets = seriesList.map((series, index) => ({
    label: series.label,
    data: stepData(series),
    borderColor: COLOURS[index % COLOURS.length],
    backgroundColor: COLOURS[index % COLOURS.length],
    pointRadius: 0,
    borderWidth: 2,
    tension: 0,
  }));

  const chart = new Chart($<HTMLCanvasElement>('#history-chart'), {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: false },
      scales: {
        x: {
          type: 'linear',
          ticks: { callback: (value) => fmtDate(new Date(Number(value)).toISOString()) },
          grid: { color: '#26364a' },
          title: { display: true, text: 'Date observed' },
        },
        y: {
          type: 'linear',
          ticks: { callback: (value) => fmtDate(new Date(Number(value)).toISOString()) },
          grid: { color: '#26364a' },
          title: { display: true, text: 'Processing applications submitted up to' },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => fmtDate(new Date(Number(items[0].parsed.x)).toISOString()),
            label: (item) =>
              `${item.dataset.label}: up to ${fmtDate(new Date(Number(item.parsed.y)).toISOString())}`,
          },
        },
      },
    },
  });

  const toggles = $('#stamp-toggles');
  seriesList.forEach((series, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = series.label;
    button.style.color = COLOURS[index % COLOURS.length];
    button.setAttribute('aria-pressed', 'true');
    button.addEventListener('click', () => {
      const visible = chart.isDatasetVisible(index);
      chart.setDatasetVisibility(index, !visible);
      button.setAttribute('aria-pressed', String(!visible));
      chart.update();
    });
    toggles.appendChild(button);
  });
}

function renderPaceChart(timeline: Timeline): void {
  const datasets = distinctSeries(timeline).map((series, index) => {
    const data = series.points
      .map((point) => {
        const pace = paceOverWindow(series.points, 30, point.observedAt);
        return pace ? { x: toTime(point.observedAt), y: pace.rate } : null;
      })
      .filter((point): point is { x: number; y: number } => point !== null);
    return {
      label: series.label,
      data,
      borderColor: COLOURS[index % COLOURS.length],
      backgroundColor: COLOURS[index % COLOURS.length],
      pointRadius: 0,
      borderWidth: 2,
      tension: 0,
    };
  });

  new Chart($<HTMLCanvasElement>('#pace-chart'), {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: false },
      scales: {
        x: {
          type: 'linear',
          ticks: { callback: (value) => fmtDate(new Date(Number(value)).toISOString()) },
          grid: { color: '#26364a' },
        },
        y: {
          beginAtZero: true,
          grid: { color: '#26364a' },
          title: { display: true, text: 'Backlog days cleared per calendar day' },
        },
      },
      plugins: {
        legend: { labels: { color: '#93a4b5' } },
        tooltip: {
          callbacks: {
            title: (items) => fmtDate(new Date(Number(items[0].parsed.x)).toISOString()),
            label: (item) => `${item.dataset.label}: ${Number(item.parsed.y).toFixed(2)} d/day`,
          },
        },
      },
    },
  });
}

async function init(): Promise<void> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}data/timeline.json`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const timeline = (await response.json()) as Timeline;

    $<HTMLAnchorElement>('#source-link').href = timeline.sourceUrl;
    $('#footer-meta').textContent = `Dataset generated ${fmtDate(timeline.generatedAt)} from ${
      timeline.observationCount
    } archived snapshots.`;

    renderStatus(timeline);
    renderEstimator(timeline);
    renderHistoryChart(timeline);
    renderPaceChart(timeline);
  } catch (error) {
    $('#freshness').innerHTML = `<span class="error">Could not load the dataset (${
      (error as Error).message
    }). Please try again later.</span>`;
  }
}

void init();
