import Chart, { type ScriptableLineSegmentContext } from 'chart.js/auto';
import annotationPlugin, { type AnnotationOptions } from 'chartjs-plugin-annotation';
import {
  estimate,
  lagDays,
  seriesForStamp,
  toTime,
  waitTrend,
  type Estimate,
  type StampSeries,
  type Timeline,
} from './lib/timeline.ts';

Chart.register(annotationPlugin);

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
const GRID = '#26364a';
const MUTED = '#93a4b5';
const DAY = 86_400_000;

const GAP_DASH_DAYS = 21;

/** Dash any segment spanning a long archive gap, so interpolation is not read as data. */
const gapSegment = {
  borderDash: (ctx: ScriptableLineSegmentContext): number[] | undefined =>
    Number(ctx.p1.parsed.x) - Number(ctx.p0.parsed.x) > GAP_DASH_DAYS * DAY ? [4, 4] : undefined,
};

const $ = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
};

const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-IE', { day: '2-digit', month: 'short', year: 'numeric' });

const fmtShort = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-IE', { month: 'short', year: '2-digit' });

const fmtWeeks = (days: number): string => {
  const weeks = days / 7;
  if (weeks < 1) return `${Math.max(Math.round(days), 0)} days`;
  return `${weeks < 10 ? weeks.toFixed(1) : Math.round(weeks)} weeks`;
};

const fmtFromNow = (iso: string): string => {
  const days = (toTime(iso) - Date.now()) / DAY;
  return days < 3 ? 'any day now' : fmtWeeks(days);
};

/** Plain-language description of how the wait itself is moving. */
interface Trend {
  /** Phrasing for the status table cell. */
  text: string;
  /** Phrasing for the headline sentence, which reads "… behind — and <clause>." */
  clause: string;
  className: 'trend-better' | 'trend-steady' | 'trend-worse' | 'trend-unknown';
}

function describeTrend(series: StampSeries): Trend {
  const pace = series.pace.d30 ?? series.pace.d90;
  if (!pace) {
    return {
      text: 'not enough updates yet',
      clause: 'there are not yet enough updates to see a trend',
      className: 'trend-unknown',
    };
  }

  // Days of wait added per calendar day, scaled to a month for readability.
  const perMonth = (waitTrend(pace.rate) * 30) / 7;
  const waitWeeks = lagDays(series.current) / 7;

  if (Math.abs(perMonth) < 0.25) {
    return { text: 'holding steady', clause: 'the wait is holding steady', className: 'trend-steady' };
  }
  if (perMonth > 0) {
    return {
      text: `grew ~${perMonth.toFixed(1)} weeks`,
      clause: `the wait grew ~${perMonth.toFixed(1)} weeks over the last month`,
      className: 'trend-worse',
    };
  }

  // The wait cannot shrink past zero, so never imply an improvement larger than the wait left.
  if (waitWeeks <= 3) {
    return {
      text: 'essentially caught up',
      clause: 'this queue is essentially caught up, working through recent submissions',
      className: 'trend-better',
    };
  }
  const shown = Math.min(Math.abs(perMonth), waitWeeks).toFixed(1);
  return {
    text: `shrank ~${shown} weeks`,
    clause: `the wait shrank ~${shown} weeks over the last month`,
    className: 'trend-better',
  };
}

/** Unique series — grouped stamps share identical data, so only draw each group once. */
function distinctSeries(timeline: Timeline): StampSeries[] {
  const seen = new Set<string>();
  return timeline.stamps.filter((series) => {
    if (seen.has(series.label)) return false;
    seen.add(series.label);
    return true;
  });
}

function renderStatus(timeline: Timeline): void {
  const staleDays = (Date.now() - toTime(timeline.latestObservedAt)) / DAY;
  $('#freshness').textContent =
    `ISD last updated this ${fmtDate(timeline.latestObservedAt)}` +
    `${staleDays > 1.5 ? ` (${Math.round(staleDays)} days ago)` : ''} · ` +
    `${timeline.observationCount} updates recorded since ${fmtDate(timeline.stamps[0].first.observedAt)}`;

  const body = $('#status-table tbody');
  body.innerHTML = '';
  for (const group of timeline.groups) {
    const series = timeline.stamps.find((s) => s.stamp === group.stamps[0]);
    if (!series) continue;
    const trend = describeTrend(series);
    const row = document.createElement('tr');
    row.innerHTML = `
      <td data-label="Stamp category">${group.label}</td>
      <td data-label="Now processing submissions from"><strong>${fmtDate(group.date)}</strong></td>
      <td data-label="Wait right now">${fmtWeeks(lagDays(series.current))}</td>
      <td data-label="Trend (last 30 days)" class="${trend.className}">${trend.text}</td>`;
    body.appendChild(row);
  }
}

function renderHeadline(timeline: Timeline, stamp: string): void {
  const series = seriesForStamp(timeline, stamp);
  if (!series) return;
  const trend = describeTrend(series);
  $('#headline-summary').innerHTML =
    `Category <strong>${series.label}</strong> is <strong>${fmtWeeks(lagDays(series.current))}</strong> ` +
    `behind — and <span class="${trend.className}">${trend.clause}</span>.`;
}

function renderEstimate(timeline: Timeline, series: StampSeries, submitted: string): Estimate {
  const outcome = estimate(series, submitted);
  const result = $<HTMLDivElement>('#estimate-result');
  result.hidden = false;

  const context = `<p class="muted">Category "${series.label}" had reached submissions from
    <strong>${fmtDate(series.current.date)}</strong> when ISD last updated on
    ${fmtDate(series.current.observedAt)}.</p>`;

  if (outcome.status === 'reached') {
    result.innerHTML = `<p class="headline good">Your date has already been reached</p>
      <p>Applications submitted on ${fmtDate(submitted)} are ${fmtWeeks(-outcome.gapDays)} inside
      the processed window, so yours should be decided already or imminently.</p>${context}`;
    return outcome;
  }
  if (outcome.status === 'stalled') {
    result.innerHTML = `<p class="headline warn">This queue is not moving</p>
      <p>No progress has been published recently, so no honest estimate can be made. You are
      ${fmtWeeks(outcome.gapDays)} of submissions behind the current front.</p>${context}`;
    return outcome;
  }
  if (outcome.status === 'insufficient-data') {
    result.innerHTML = `<p class="headline warn">Not enough history yet</p>
      <p>There are too few recorded updates for this category to measure a speed.</p>${context}`;
    return outcome;
  }

  const { central, optimistic, pessimistic, cardIso } = outcome;
  result.innerHTML = `
    <p class="headline">≈ ${fmtDate(central!.etaIso)}</p>
    <p>${
      fmtFromNow(central!.etaIso) === 'any day now'
        ? '<strong>Any day now.</strong>'
        : `About <strong>${fmtFromNow(central!.etaIso)}</strong> from today.`
    } This is a best guess that
    could easily move by several weeks — it assumes the queue keeps moving at the speed of the last
    month.</p>
    <div class="range">
      <div><span>If it speeds up</span><strong>${fmtDate(optimistic!.etaIso)}</strong></div>
      <div class="central"><span>If the current pace holds</span><strong>${fmtDate(
        central!.etaIso,
      )}</strong></div>
      <div><span>If it slows down</span><strong>${fmtDate(pessimistic!.etaIso)}</strong></div>
    </div>
    <p class="muted">Add roughly three more weeks for the new card to arrive by post — around
    ${fmtDate(cardIso!)} if the central estimate holds.</p>
    ${context}`;
  return outcome;
}

let waitChart: Chart | undefined;
let frontChart: Chart | undefined;

function renderWaitChart(timeline: Timeline): void {
  const seriesList = distinctSeries(timeline);
  const datasets = seriesList.map((series, index) => ({
    label: series.label,
    data: series.points.map((point) => ({ x: toTime(point.observedAt), y: lagDays(point) / 7 })),
    borderColor: COLOURS[index % COLOURS.length],
    backgroundColor: COLOURS[index % COLOURS.length],
    pointRadius: 2,
    borderWidth: 2,
    tension: 0,
    segment: gapSegment,
  }));

  const annotations: Record<string, AnnotationOptions> = {
    today: {
      type: 'line',
      xMin: Date.now(),
      xMax: Date.now(),
      borderColor: MUTED,
      borderWidth: 1,
      borderDash: [4, 4],
      label: { display: true, content: 'today', position: 'start', color: MUTED, backgroundColor: 'transparent', font: { size: 10 } },
    },
  };

  if (timeline.categorySplitAt) {
    annotations.sharedEra = {
      type: 'box',
      xMin: toTime(timeline.stamps[0].first.observedAt),
      xMax: toTime(timeline.categorySplitAt),
      backgroundColor: 'rgba(147, 164, 181, 0.07)',
      borderWidth: 0,
      label: {
        display: true,
        content: 'one shared queue',
        position: { x: 'center', y: 'start' },
        color: MUTED,
        font: { size: 10 },
      },
    };
    $('#split-note').textContent =
      'In the shaded period ISD published a single date covering every stamp category, so the ' +
      `lines are identical. Separate per-category dates first appear on ${fmtDate(
        timeline.categorySplitAt,
      )}. Dashed segments span gaps where no archived update exists.`;
  }

  waitChart = new Chart($<HTMLCanvasElement>('#wait-chart'), {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: false },
      scales: {
        x: {
          type: 'linear',
          ticks: {
            maxTicksLimit: 6,
            callback: (value) => fmtShort(new Date(Number(value)).toISOString()),
            color: MUTED,
          },
          grid: { color: GRID },
        },
        y: {
          beginAtZero: true,
          ticks: { callback: (value) => `${value}w`, color: MUTED },
          grid: { color: GRID },
          title: { display: true, text: 'Wait, in weeks', color: MUTED },
        },
      },
      plugins: {
        legend: { display: false },
        annotation: { annotations },
        tooltip: {
          callbacks: {
            title: (items) => fmtDate(new Date(Number(items[0].parsed.x)).toISOString()),
            label: (item) =>
              `${item.dataset.label}: ${Number(item.parsed.y).toFixed(1)} weeks behind`,
          },
        },
      },
    },
  });

  const toggles = $('#stamp-toggles');
  toggles.innerHTML = '';
  seriesList.forEach((series, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = series.label;
    button.style.color = COLOURS[index % COLOURS.length];
    button.setAttribute('aria-pressed', 'true');
    button.addEventListener('click', () => {
      const visible = waitChart!.isDatasetVisible(index);
      waitChart!.setDatasetVisibility(index, !visible);
      button.setAttribute('aria-pressed', String(!visible));
      waitChart!.update();
    });
    toggles.appendChild(button);
  });
}

/** Step-function data so the front is drawn as horizontal-then-vertical steps. */
function stepData(series: StampSeries): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  series.points.forEach((point, index) => {
    if (index > 0) {
      points.push({ x: toTime(point.observedAt), y: toTime(series.points[index - 1].date) });
    }
    points.push({ x: toTime(point.observedAt), y: toTime(point.date) });
  });
  return points;
}

function renderFrontChart(timeline: Timeline): void {
  const datasets = distinctSeries(timeline).map((series, index) => ({
    label: series.label,
    data: stepData(series),
    borderColor: COLOURS[index % COLOURS.length],
    backgroundColor: COLOURS[index % COLOURS.length],
    pointRadius: 0,
    borderWidth: 2,
    tension: 0,
    segment: gapSegment,
  }));

  frontChart = new Chart($<HTMLCanvasElement>('#front-chart'), {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: false },
      scales: {
        x: {
          type: 'linear',
          ticks: {
            maxTicksLimit: 6,
            callback: (value) => fmtShort(new Date(Number(value)).toISOString()),
            color: MUTED,
          },
          grid: { color: GRID },
          title: { display: true, text: 'Date ISD published the update', color: MUTED },
        },
        y: {
          type: 'linear',
          ticks: {
            maxTicksLimit: 6,
            callback: (value) => fmtShort(new Date(Number(value)).toISOString()),
            color: MUTED,
          },
          grid: { color: GRID },
          title: { display: true, text: 'Submissions reached', color: MUTED },
        },
      },
      plugins: {
        legend: { labels: { color: MUTED, boxWidth: 12 } },
        annotation: { annotations: {} },
        tooltip: {
          callbacks: {
            title: (items) => fmtDate(new Date(Number(items[0].parsed.x)).toISOString()),
            label: (item) =>
              `${item.dataset.label}: reached ${fmtDate(
                new Date(Number(item.parsed.y)).toISOString(),
              )}`,
          },
        },
      },
    },
  });
}

/** Draw the user's submission date, today, and their projected ETA onto both charts. */
function annotatePersonal(series: StampSeries, submitted: string, outcome: Estimate): void {
  if (!waitChart || !frontChart) return;

  const personalWait = (Date.now() - toTime(submitted)) / DAY / 7;
  const waitAnnotations = waitChart.options.plugins!.annotation!.annotations as Record<
    string,
    AnnotationOptions
  >;
  waitAnnotations.you = {
    type: 'line',
    yMin: personalWait,
    yMax: personalWait,
    borderColor: '#f2f2f2',
    borderWidth: 1,
    borderDash: [5, 5],
    label: {
      display: true,
      content: `you have waited ${fmtWeeks((Date.now() - toTime(submitted)) / DAY)}`,
      position: 'start',
      color: '#0f1720',
      backgroundColor: '#f2f2f2',
      font: { size: 10 },
    },
  };
  waitChart.update();

  const frontAnnotations = frontChart.options.plugins!.annotation!.annotations as Record<
    string,
    AnnotationOptions
  >;
  frontAnnotations.submitted = {
    type: 'line',
    yMin: toTime(submitted),
    yMax: toTime(submitted),
    borderColor: '#f2f2f2',
    borderWidth: 1,
    borderDash: [5, 5],
    label: {
      display: true,
      content: `your submission (${fmtDate(submitted)})`,
      position: 'start',
      color: '#0f1720',
      backgroundColor: '#f2f2f2',
      font: { size: 10 },
    },
  };
  frontAnnotations.today = {
    type: 'line',
    xMin: Date.now(),
    xMax: Date.now(),
    borderColor: MUTED,
    borderWidth: 1,
    borderDash: [4, 4],
  };

  if (outcome.status === 'estimated') {
    const { central } = outcome;
    frontAnnotations.projection = {
      type: 'line',
      xMin: toTime(series.current.observedAt),
      xMax: toTime(central!.etaIso),
      yMin: toTime(series.current.date),
      yMax: toTime(submitted),
      borderColor: '#2fb98d',
      borderWidth: 2,
      borderDash: [6, 4],
    };
    frontAnnotations.eta = {
      type: 'point',
      xValue: toTime(central!.etaIso),
      yValue: toTime(submitted),
      backgroundColor: '#2fb98d',
      radius: 5,
    };
    frontAnnotations.etaLabel = {
      type: 'label',
      xValue: toTime(central!.etaIso),
      yValue: toTime(submitted),
      content: [`≈ ${fmtDate(central!.etaIso)}`],
      color: '#06231b',
      backgroundColor: '#2fb98d',
      font: { size: 11, weight: 'bold' },
      yAdjust: -22,
      xAdjust: -40,
    };
  }
  frontChart.update();
  $<HTMLDetailsElement>('#detail').open = true;
}

function setupEstimator(timeline: Timeline): void {
  const select = $<HTMLSelectElement>('#stamp-select');
  select.innerHTML = '';
  for (const option of STAMP_OPTIONS) {
    const element = document.createElement('option');
    element.value = option.value;
    const series = seriesForStamp(timeline, option.value);
    element.textContent =
      series && series.stamp !== option.value && option.value !== 'OTHER'
        ? `${option.text} (counted in "${series.label}")`
        : option.text;
    select.appendChild(element);
  }
  select.value = '4';
  renderHeadline(timeline, select.value);
  select.addEventListener('change', () => renderHeadline(timeline, select.value));

  const input = $<HTMLInputElement>('#submitted-input');
  input.max = new Date().toISOString().slice(0, 10);

  $('#estimate-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const series = seriesForStamp(timeline, select.value);
    if (!series) return;
    const submitted = `${input.value}T12:00:00Z`;
    const outcome = renderEstimate(timeline, series, submitted);
    annotatePersonal(series, submitted, outcome);
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
    } archived snapshots of the official page.`;

    renderWaitChart(timeline);
    renderFrontChart(timeline);
    renderStatus(timeline);
    setupEstimator(timeline);
  } catch (error) {
    $('#headline-summary').innerHTML = `<span class="error">Could not load the dataset (${
      (error as Error).message
    }). Please try again later.</span>`;
  }
}

void init();
