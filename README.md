# IRP Renewal Tracker

An unofficial web app that tracks how fast Irish Residence Permit (IRP) renewal applications are
being processed, keeps the history that the official page throws away, and estimates when your
own application will be reached.

Immigration Service Delivery (ISD) publishes a "Current Processing Timelines" table showing, per
stamp category, the submission date they are currently working on. It is overwritten in place, so
there is no way to see whether the queue is speeding up or stalling — or to work out an ETA
without doing the arithmetic by hand every week.

## What it does

- **Collects history.** Archived versions of the official page are read from the Wayback Machine
  and parsed into an append-only dataset (`data/observations.json`). History currently reaches
  back to November 2024.
- **Measures pace.** For every stamp code it derives a step-function series and the pace —
  *backlog days cleared per calendar day* — over 30-day, 90-day and all-time windows.
  Above `1.00 d/day` means the queue is catching up faster than time passes.
- **Estimates your date.** Enter your stamp category and submission date to get a central ETA with
  an optimistic/pessimistic range, plus the expected card-in-the-post date (+15 business days).

The site is fully static: a GitHub Actions cron job refreshes the data, commits it, and deploys to
GitHub Pages. No server, no accounts, no cost.

## Data notes

- The live ISD site is behind Cloudflare and rejects plain HTTP clients, so the Wayback Machine is
  the data source. Each run also asks the archive to take a fresh capture.
- Page versions before 2026 published a single date for everyone ("…applications for renewal
  submitted on 29/10/2025"); those are recorded as applying to all stamp categories, which keeps
  each stamp's series continuous across the change to per-category rows.
- Series are keyed by individual stamp code, not by the published grouping, so regrouping (for
  example `1, 1H` splitting apart) does not break the history.
- Snapshots where the archive captured a Cloudflare challenge instead of the page are skipped.

## Development

```bash
npm install
npm run dev        # local dev server
npm test           # parser, pace and ETA tests
npm run typecheck  # tsc --noEmit
npm run build      # static build into dist/
```

Data pipeline:

```bash
npm run collect    # fetch new archived snapshots into data/observations.json
npm run derive     # build public/data/timeline.json from the observations
npm run update     # request a fresh capture, collect, then derive
```

Useful flags: `node scripts/collect.ts --limit=5` (only the newest snapshots),
`--recheck` (re-examine snapshots previously skipped, e.g. after a parser change).

## Deployment

Push to `main` with GitHub Pages set to "GitHub Actions" as the source. The
`update-and-deploy` workflow runs twice daily, commits any new observations, and publishes.

## Disclaimer

Unofficial and informational only. Not affiliated with or endorsed by the Department of Justice or
Immigration Service Delivery. Estimates are extrapolations from past pace and can be wrong — always
rely on official communications about your application.
