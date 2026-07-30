# IRP Renewal Tracker

**Live: https://stasfeelin.github.io/irp-renewal-tracker/**

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
- **Shows the wait, in weeks.** The headline chart plots the gap between the day ISD published an
  update and the submission date they had reached — i.e. how long the queue is actually running
  behind. A rising line means it is falling further behind. Stamp 4's wait has grown from about
  3 weeks in late 2024 to roughly 18 weeks.
- **Estimates your date.** Enter your stamp category and submission date to get a central ETA, a
  faster/slower range, and a soft expectation for the card arriving by post.

The site is fully static: a GitHub Actions cron job refreshes the data, commits it, and deploys to
GitHub Pages. No server, no accounts, no cost.

## Honest-numbers rules

The queue is a stressful thing to be stuck in, so the app is deliberately conservative:

- Speed is measured **between two real published updates** inside each window. The archive has
  sparse monthly snapshots before 2026 and dense daily ones after; interpolating from the window
  boundary let a multi-month advance be credited to a 30-day window, inflating the measured speed
  several-fold and producing over-optimistic ETAs.
- The central estimate uses the **most recent window that has enough updates behind it**, not the
  long-run average, which is dominated by a period when the queue behaved very differently.
- The faster/slower range is widened to a minimum spread, so it can never imply day-level
  precision that the data cannot support.
- Colour encodes the **direction of the wait**, not raw speed: a category can be clearing days
  quickly and still be falling further behind.

## Data notes

- The live ISD site is behind Cloudflare and rejects plain HTTP clients, so the Wayback Machine is
  the data source. Each run also asks the archive to take a fresh capture.
- Page versions before 2026 published a single date for everyone ("…applications for renewal
  submitted on 29/10/2025"); those are recorded as applying to all stamp categories, which keeps
  each stamp's series continuous across the change to per-category rows.
- Series are keyed by individual stamp code, not by the published grouping, so regrouping (for
  example `1, 1H` splitting apart) does not break the history.
- Snapshots where the archive captured a Cloudflare challenge instead of the page are skipped.

## Licensing and re-use

The code is MIT licensed (see `LICENSE`). The underlying dates are © Department of Justice.

ISD's own terms and conditions expressly permit re-use: *"You may re-use the information on this
website free of charge in any format… we encourage the re-use of the information that we produce"*,
subject to conditions that this project is built to satisfy:

| Condition | How this project meets it |
| --- | --- |
| Acknowledge the source and their copyright | Footer credit and link on every page, plus `LICENSE` |
| Reproduce the information accurately | Published dates are stored verbatim and never adjusted; parsing is covered by tests |
| Do not use the information in a misleading way | Derived figures are labelled as this site's own; see "Honest-numbers rules" above |
| Not principally for advertising or promoting a product | No ads, no tracking, no commercial content |
| Not for illegal or dishonest purposes | Informational only |

The site's `robots.txt` allows crawling (`Disallow:` empty, `Crawl-delay: 10`). In practice this
project does not crawl the live site at all — it reads the Internet Archive, at a polite rate.

No personal data is collected. The estimator runs entirely in the browser; the submission date you
type is never transmitted anywhere and there is no backend, no cookies and no analytics.

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

Deployed to GitHub Pages at https://stasfeelin.github.io/irp-renewal-tracker/ with the Pages source
set to "GitHub Actions". The `update-and-deploy` workflow runs on every push to `main` and twice
daily on a cron, commits any new observations back to the repo, and publishes the rebuilt site.

## Disclaimer

Unofficial and informational only. Not affiliated with or endorsed by the Department of Justice or
Immigration Service Delivery. Estimates are extrapolations from past pace and can be wrong — always
rely on official communications about your application.
