# NSW Driving Test Slot Alerts

A zero-backend public alert system for earliest NSW driving test slots.

- A scheduled GitHub Actions job logs into the official Service NSW
  "view, change or cancel" page using the **site operator's own** booking
  details, reads the earliest available slot at a target test centre, and
  writes `docs/status.json`.
- A static site under `docs/` is hosted on GitHub Pages. Visitors see the
  latest known earliest slot and can subscribe to a public Telegram channel
  or ntfy topic for change alerts.
- No database, no server, no visitor accounts, no visitor data collection.
- The watcher never books, changes, cancels, or confirms anything. It only
  reads the earliest slot.

> Important: Running this against Service NSW / myRTA may breach their terms.
> You are responsible for compliance, rate limits, and your own booking data.

## How the modes work

`watch_nsw_slots.js` has two modes.

### Personal watcher (default)

- Reads your booking date.
- Alerts you only when the earliest Botany slot is strictly earlier than your
  current booking date.
- Sends Mac, ntfy, Pushover, and/or Telegram notifications.
- Used locally; never in CI.

### Public broadcast (`PUBLIC_BROADCAST=1`)

- Still logs in with the site operator's `BOOKING_NUMBER` / `FAMILY_NAME` to
  reach the change-date page (Service NSW does not expose slot data without a
  booking).
- Compares the new earliest slot against the previously recorded earliest
  slot, regardless of the operator's own booking date.
- Writes `docs/status.json` (consumed by the static site).
- Writes `state/public_broadcast_state.json` (used locally; in CI we instead
  fall back to the previous `docs/status.json`, see below).
- Sends a public Telegram / ntfy alert when the earliest slot changes.
- `docs/status.json` **never** contains booking number, family name, cookies,
  session ids, or tokens.

## Local setup

Requires Node 18+ and Playwright. The watcher launches Chromium.

```sh
npm install
npx playwright install chromium
cp .env.example .env
# Edit .env and set BOOKING_NUMBER and FAMILY_NAME locally.
```

`.env` is gitignored. Never commit it.

### Run the personal watcher once

```sh
./run_watch_once.sh
```

### Run the personal watcher continuously

```sh
./run_watch_loop.sh
```

Keep the Mac awake while watching:

```sh
caffeinate -dims ./run_watch_loop.sh
```

### Run a single public broadcast check locally

This is what GitHub Actions runs in CI. It writes `docs/status.json` and
`state/public_broadcast_state.json`.

```sh
./run_public_broadcast_once.sh
```

## Environment variables

| Variable                | Purpose                                                  |
| ----------------------- | -------------------------------------------------------- |
| `BOOKING_NUMBER`        | Site operator's myRTA booking number. **Required.**      |
| `FAMILY_NAME`           | Site operator's family name on the booking. **Required.**|
| `PUBLIC_BROADCAST`      | `1` to enable public broadcast mode.                     |
| `TARGET_LOCATION`       | Test centre name to show in messages. Default `Botany`.  |
| `STATUS_JSON_PATH`      | Default `docs/status.json`.                              |
| `STATE_PATH`            | Default `state/public_broadcast_state.json`.             |
| `INTERVAL_MINUTES_MIN`  | Loop mode lower bound. Default `25`.                     |
| `INTERVAL_MINUTES_MAX`  | Loop mode upper bound. Default `35`.                     |
| `INTERVAL_MINUTES`      | Fixed loop interval, overrides min/max.                  |
| `HEARTBEAT_NOTIFY`      | `0` to disable heartbeat in personal mode.               |
| `NTFY_TOPIC`            | ntfy topic name or full URL.                             |
| `NTFY_SERVER`           | Custom ntfy server. Default `https://ntfy.sh`.           |
| `TELEGRAM_BOT_TOKEN`    | Telegram bot token for public channel posts.             |
| `TELEGRAM_CHAT_ID`      | Telegram chat/channel id.                                |
| `PUSHOVER_TOKEN`        | Personal notifications only.                             |
| `PUSHOVER_USER`         | Personal notifications only.                             |
| `HEADFUL`               | `1` to run Chromium headful for debugging.               |
| `ONCE`                  | `1` to run a single check and exit.                      |

## Deploying the static site on GitHub Pages

1. Push this repo to GitHub.
2. Go to **Settings → Pages**.
3. Set **Source = GitHub Actions**.
4. Save. The `watch-public-broadcast` workflow deploys the `docs/` folder
   after each successful watcher run.
5. Pages will publish at `https://<user>.github.io/<repo>/`.

The site reads `./status.json` relative to the page. Until the first
workflow run produces a real `docs/status.json`, the site shows
"No recent status available". You can rename `docs/status.example.json` to
`docs/status.json` for a one-time placeholder if you prefer.

Before publishing, edit `docs/index.html` and replace the placeholders:

- `https://t.me/your_channel` → your real Telegram channel URL.
- `https://ntfy.sh/your-topic` → your real ntfy topic URL.

## Configuring GitHub Actions

The workflow lives at `.github/workflows/watch-public-broadcast.yml`.

It runs the watcher, commits `docs/status.json` back to the repo for the next
run's change detection, and deploys the current `docs/` directory to GitHub
Pages from the same workflow. This avoids relying on a Pages build being
triggered by a `GITHUB_TOKEN` commit.

### Required secrets

Set these under **Settings → Secrets and variables → Actions → Repository
secrets**:

- `BOOKING_NUMBER` — site operator's booking number.
- `FAMILY_NAME` — site operator's family name.

### Optional secrets

At least one notification channel is recommended:

- `NTFY_TOPIC` — ntfy topic (name or full URL) for the public channel.
- `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` — public Telegram channel.

The workflow runs every 30 minutes on an offset schedule and is also available via
**Actions → watch-public-broadcast → Run workflow** for manual dispatch.

If the commit step fails with a permissions error, go to
**Settings → Actions → General → Workflow permissions** and allow read and
write permissions for workflows.

### How "changed" is detected in CI

GitHub Actions runners are stateless: `state/` is not preserved between
runs. The watcher therefore loads the previous earliest slot from, in order:

1. `STATE_PATH` (`state/public_broadcast_state.json`) if it exists.
2. Otherwise `STATUS_JSON_PATH` (`docs/status.json`) committed in the repo.

In CI we rely on (2): each run checks out the previously committed
`docs/status.json`, computes the new earliest slot, sets `changed` accordingly,
and the workflow commits `docs/status.json` only if it differs.

On the very first run, no previous state exists, so `changed=false` and
`firstRun=true`. No alert is sent on the first run.

## Limits and caveats of this 0-backend setup

- GitHub's `cron` is not exact: the every-30-minutes schedule can be delayed
  by many minutes under load.
- GitHub may **disable scheduled workflows on inactive repos** (no recent
  pushes for ~60 days). Push or manually run the workflow occasionally to
  keep it alive.
- Frequent automated requests to Service NSW / myRTA may violate their terms
  of service, trigger bot protection, or fail silently. Keep the interval
  conservative.
- Secrets are passed via `${{ secrets.* }}`. Do not print them to logs and do
  not echo them in custom steps. Public repo Action logs are world-readable.
- This site collects nothing from visitors: no booking number, no family
  name, no email, no phone, no analytics.
- The watcher never modifies a booking; visitors must complete any change on
  the official Service NSW website.

## Validation

After making changes locally:

```sh
node --check watch_nsw_slots.js
node --check myrta_english_proxy.js
```

Search the repo for accidentally committed credentials before pushing:

```sh
rg -n "BOOKING_NUMBER\s*=\s*[0-9]" -g '!node_modules' -g '!.env'
rg -n "FAMILY_NAME\s*=\s*[A-Za-z]" -g '!node_modules' -g '!.env'
```
