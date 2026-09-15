# Suarza International — Weighbridge Software

Offline-first weighbridge (truck scale) management software. A truck drives onto
the bridge, an indicator streams its weight over serial to the on-site PC, and
our software records the transaction, prints a receipt, and syncs it to the
cloud for managers to view from anywhere.

**The bridge never depends on the internet.** Weighing writes to local SQLite
immediately and unconditionally; the cloud only receives completed records
afterwards, through an outbox queue.

## Documentation

| Document                                              | Written for                        |
| ----------------------------------------------------- | ---------------------------------- |
| [Operator guide](docs/operator-manual.md)             | The operator at the weighbridge    |
| [Configuration guide](docs/configuration.md)          | Whoever deploys and maintains it   |
| [Windows install guide](apps/agent/windows/README.md) | Whoever sets up the weighbridge PC |

## Repository layout

```
suarza-weighbridge/
├── packages/
│   ├── shared/        Types, Zod schemas, domain constants, unit maths, slip numbers
│   ├── ui/            shadcn/ui components + the Suarza theme, shared by both PWAs
│   └── receipt-pdf/   PDFKit receipt builder, used by BOTH Node tiers
└── apps/
    ├── agent/         Node service on the weighbridge PC: serial + SQLite + local API + sync
    ├── server/        Cloud API (Express + MongoDB Atlas) + serves the manager PWA
    ├── operator-web/  Operator PWA — served by the agent, works fully offline
    └── manager-web/   Manager dashboard PWA — served from the cloud
```

`packages/shared` is the single source of domain truth. Net weight, unit
conversion, slip-number format and every validation rule are defined there once
and imported by all three tiers — nothing re-implements them locally.

## Getting started

Requires **Node 20+** and **pnpm** (via corepack: `corepack enable pnpm`).

```bash
pnpm install
pnpm build        # build every package
pnpm test         # run the test suites
pnpm typecheck
pnpm lint
```

## Configuration

Every deployable reads its config from environment variables. Real values live
only in un-committed `.env` files; the repo ships `.env.example` placeholders.

| App       | File               | Notes                                                                                      |
| --------- | ------------------ | ------------------------------------------------------------------------------------------ |
| Cloud API | `apps/server/.env` | `MONGODB_URI` **must end in `/suarzaweightbridge`** — one variable, database name included |
| Agent     | `apps/agent/.env`  | Serial port settings; `USE_SIMULATOR=true` runs with no hardware                           |

The agent never holds a database credential. It authenticates to the cloud with
an ingest API key only; the Mongo credential lives solely on the droplet.

## Running the agent

```bash
cp apps/agent/.env.example apps/agent/.env    # then set USE_SIMULATOR=true
pnpm --filter @suarza/agent dev               # http://127.0.0.1:3100
```

The API is bound to loopback only — the operator PWA is served by this same
process, and nothing off the weighbridge PC has any business reaching it.

| Route                              | Purpose                                                  |
| ---------------------------------- | -------------------------------------------------------- |
| `GET /live-weight`                 | Current reading, stability, connection state             |
| `GET /sync-status`                 | Pending-sync count and online state                      |
| `POST /weighments`                 | Pass 1 — save first weight, returns the slip number      |
| `GET /weighments/:slip`            | Fetch for pass 2; accepts `SI-000123`, `000123` or `123` |
| `PATCH /weighments/:slip/complete` | Pass 2 — second weight, net, amount                      |
| `POST /weighments/:slip/void`      | Void an open ticket, reason required                     |
| `POST /weighments/:slip/reprint`   | Log a reprint                                            |
| `GET /weighments/:slip/audit`      | The record's full audit trail                            |

## Running the operator app

The agent serves the built PWA, so in production the operator opens one URL and
everything — UI, data and the scale — comes from the PC in front of them.

```bash
pnpm --filter @suarza/operator-web build   # then start the agent
pnpm --filter @suarza/agent dev            # http://127.0.0.1:3100
```

For UI work, run Vite instead and let it proxy the agent routes:

```bash
pnpm --filter @suarza/agent dev            # terminal 1
pnpm --filter @suarza/operator-web dev     # terminal 2 → http://localhost:5173
```

**Two modes** (brief §9), switched from the header: **New** for an arriving
truck, **Return** for one coming back with a slip. Only the active mode is
mounted — both bind the same function keys, so leaving the other alive would
make `F9` ambiguous, and a weight captured for one pass is cleared when the mode
changes rather than carried across.

**Keyboard shortcuts:** `F2` capture weight · `F3` jump to the slip field ·
`F4` clear / another slip · `F9` save or complete.

**Customer directory.** The weighing form has a searchable picker for customers
weighed here before; choosing one fills in name, company, phone and the truck
and load they last brought. The directory is a by-product of weighing — there is
no "add a customer" step, so it cannot go stale. A new weighing _fills in_ what
is missing and refreshes the last-used details, but never blanks something that
was already there: an operator who skips the phone box today must not erase the
number someone typed last week.

**Recent weighments.** The second-weight screen lists what has been weighed
recently, tickets still awaiting a second weight first, so the operator can
click instead of reading a dusty slip — and a driver who has lost their slip can
still be found.

**Pass 2 edge cases**, all resolving to a next action rather than a dead end:

| Situation                    | What the operator sees                                                 |
| ---------------------------- | ---------------------------------------------------------------------- |
| Slip mistyped                | Inline message under the field, nothing to dismiss, field stays usable |
| Slip already completed       | Re-completion blocked; a reprint is offered instead                    |
| Slip already voided          | The record and its void reason, read-only                              |
| Truck never returned         | Void with a mandatory reason — the record is kept, not deleted         |
| Completed elsewhere mid-edit | The record is re-fetched and shown as it really is                     |

The net weight is previewed in kg, ton and maund from the captured snapshot
**before** anything is committed, so the figure is never a surprise on the
printed receipt.

**Capture rules (brief §7.1).** The operator commits a frozen snapshot, never
whatever is streaming at submit time. What the button does depends on what the
indicator can tell us:

| Indicator says           | Capture                                               |
| ------------------------ | ----------------------------------------------------- |
| Stable                   | One click, captured                                   |
| No stability flag at all | Captured, then confirmed against the physical display |
| Unstable                 | Blocked — wait, or enter manually                     |
| Nothing (unplugged/off)  | Blocked — enter manually                              |

"No stability flag" and "unstable" are deliberately different cases. Manual
entry is always available, and is flagged on the record, on the receipt and in
the audit log.

## Receipts and printing

Two receipts print per completed transaction (brief §3): one after the first
weight, one after completion. Both are the **same component** in two forms —
two components would drift, and a preview that disagreed with the paper would
be worse than no preview at all.

| Form     | Where                                              | Header & footer                               |
| -------- | -------------------------------------------------- | --------------------------------------------- |
| **Soft** | On-screen preview, and the page behind the QR code | Included — logo, company name, address, phone |
| **Hard** | What the printer produces                          | **Stripped.** Central block only              |

The hard form carries no branding because receipts print onto **pre-printed
letterhead pads** that already have it, in colour. `@media print` does the
stripping, so both forms stay one `Receipt` in `packages/ui` — shared because
the operator printout, the manager dashboard reprint and the public QR page all
need identical markup.

**Printing opens in a new tab**, so the operator sees what is about to come out
and can print it again without redoing the weighing. **Download PDF** saves the
full soft form — header and footer included — and is built by the **agent**, not
the cloud, so it works with the internet down.

**Calibration.** The block has to land inside the pad's blank area, and no two
printers agree on where a page starts. Settings (gear icon) has paper size,
top/left offsets in millimetres, and a scale, plus a **test print** that puts a
dashed outline and a 100 mm measuring bar on a blank pad sheet — if the bar
isn't 100 mm, the printer is scaling the page and every offset is wrong.

Print settings live in this browser's `localStorage`: they describe the printer
in front of you, not the record. M8 moves them into the agent so a cleared
browser profile doesn't lose the calibration.

**QR code** encodes `{receipt web address}/r/{slip_number}`. Until that address
is set in Settings, **no QR is printed at all** — a code that resolves nowhere
on a customer's receipt is worse than none. The page it points at is built in
M5; scanning needs internet and the record to have synced.

**Honesty markers on the paper:** a manually entered weight is flagged
`(manual)`, and a reprint is stamped `REPRINT` so it cannot be passed off as the
original slip.

## Cloud API

Runs on the DigitalOcean droplet under PM2, behind Nginx with a Let's Encrypt
certificate (brief §14). Connects to MongoDB Atlas — **data only**; auth and
receipt-serving are ours.

```bash
cp apps/server/.env.example apps/server/.env    # fill in MONGODB_URI etc.
pnpm --filter @suarza/server dev                # http://localhost:4000
```

| Route                   | Auth       | Purpose                                         |
| ----------------------- | ---------- | ----------------------------------------------- |
| `POST /ingest`          | API key    | Agent outbox — idempotent upsert on record UUID |
| `POST /auth/login`      | public     | Manager JWT (rate-limited)                      |
| `GET /weighments`       | JWT        | Filters + server-side pagination                |
| `GET /weighments/:slip` | JWT        | One record                                      |
| `GET /analytics`        | JWT        | Dashboard figures, VOID excluded                |
| `GET /r/:slip`          | **public** | The page a driver reaches by scanning the QR    |
| `GET /r/:slip/pdf`      | **public** | PDF built in memory and streamed                |

**Idempotency** comes from using the record's UUID as the Mongo `_id`. Re-sending
a batch upserts the same documents — there is no dedupe logic to get wrong.
Ingest also refuses to let an _older_ copy overwrite a newer one, so an
out-of-order retry can't resurrect an OPEN ticket over a completed one.

**The QR routes are public by design.** The audience is a driver holding a paper
slip who has no account and never will, so the slip number is the only thing
required. That is also why they are read-only, expose no list or search, and are
marked `noindex`.

**No file storage** (brief §15). The PDF is built by PDFKit in memory on every
request and streamed; nothing is written to disk. A receipt therefore can never
drift from the record it represents, and there is no bucket to back up or leak.
The `/r/:slip` page is the _same_ `Receipt` component the operator app uses,
server-rendered — not a second copy of the markup.

## Sync engine

The agent drains its local database upward through an outbox (brief §11). Four
triggers, each covering a different way the naive version fails:

| Trigger                                                    | Why it exists                                                                                                           |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Event-driven, on every commit                              | The normal case — a record syncs within a second                                                                        |
| Exponential backoff on failure (5s → 15s → 60s → cap 2min) | A dead link isn't hammered, and a large backlog doesn't stampede                                                        |
| Sweep the moment a retry succeeds                          | Node has no reliable "the internet is back" event, so the retry **is** the probe; a success immediately drains the rest |
| Loose periodic backstop                                    | Insurance against a trigger being missed                                                                                |

A record is marked synced **only** on a confirmed 2xx that names its id.
Marking optimistically would lose weighments permanently on a partial failure.

Two things the obvious implementation gets wrong, both handled:

- **A reprint** writes an audit entry against a record that is already synced,
  so the weighment drain never sees it. A second pass sends those separately.
- **An empty outbox says nothing about the link.** The agent will not report
  "cloud connected" on the strength of having had nothing to do — with nothing
  to send it pings, and reports what it actually found.

## Manager dashboard

Served by the cloud API at its root, so a manager opens one URL. Sign in with a
manager or admin account; an operator's token is refused and the shell says so
rather than showing a dashboard that errors on every request.

Filters sit in one row above everything, and **every figure on the page obeys
them** — tiles, charts and table alike, so the three can never disagree about
what is being looked at. Quick ranges are Pakistan days: "Today" means the day
the manager is living in, not the UTC one.

**Charts are deliberately single-series.** Identity — which vehicle type, which
company, which day — is carried by the axis, so colour would encode nothing.
One validated hue does the whole job and avoids inventing eleven
colourblind-hostile hues for eleven vehicle types. Count and revenue are never
put on one pair of axes; two measures of different scale get two charts. The
mark colour was validated with the data-viz palette checker: the brand accent
itself **failed** (too dark, too desaturated to read at mark size), so the
charts use a step that passes on both the light and dark surfaces.

**On a phone the table becomes a card list.** Eight columns need ~970px and a
phone has ~360; scrolling sideways to reach the amount is not an acceptable
answer for the figure the manager opened the app for. The two are rendered
conditionally rather than hidden with CSS, so a screen reader doesn't read every
row twice.

Recharts is lazy-loaded — it is the heaviest dependency and nothing needs it
until a manager is signed in, which keeps the login screen light on a slow
mobile connection.

## Installing on the weighbridge PC

Full step-by-step instructions for whoever sets up the Windows machine are in
[`apps/agent/windows/README.md`](apps/agent/windows/README.md). In short: install
Node 20, fill in `.env`, then from an Administrator prompt:

```
node windows\install-service.cjs
```

That registers **Suarza Weighbridge Agent** as a Windows service, so it starts
at boot before anyone logs in and restarts itself if it ever stops. A service
rather than a tray app because the PC is switched on by whoever opens the yard,
and the software has to be running before anyone thinks about it.

> **Not verified on Windows.** The service scripts and the guide were written
> and syntax-checked here, but this project was built on Linux — the install,
> the auto-start and the reboot survival still need one run-through on the
> actual PC. Everything else in this README has been run.

**Silent printing:** Chrome shows a print dialog by default. Launch it with
`--kiosk-printing --app=http://localhost:3100` for receipts that print without
asking.

## Settings

Settings live in the **agent's database**, not the browser, and are edited from
the gear icon in the operator app. A print calibration or an edited rate card
therefore survives a cleared browser profile and is the same in every browser
on that PC.

| Section           | What it covers                                                    |
| ----------------- | ----------------------------------------------------------------- |
| Paper & alignment | Paper size, top/left offsets in mm, scale, test print, auto-print |
| Receipt details   | Company name, address, phone, logo, the QR's web address          |
| Pricing           | The per-vehicle rate card that auto-fills the amount              |
| Station & sync    | Station ID, sync backstop interval, backup folder and frequency   |

**Backups** use SQLite's online backup API, not a file copy — a copy taken
mid-write is corrupt, and this is the copy that matters precisely when the
original has been lost. The last 14 are kept.

## Development without hardware

The indicator protocol is not yet specified by the client, so the agent ships a
**weight simulator** (`USE_SIMULATOR=true`) that models the real cycle — empty
platform, truck rolling on, the reading swinging and then settling, truck
rolling off. The swing matters: stable-capture UX is only exercised properly if
the weight genuinely refuses to settle for a few seconds first.

While the simulator is on, three extra routes let a test or a QA script drive a
transaction deterministically instead of waiting on the cycle:

```bash
curl -X POST localhost:3100/simulator/weight -H 'content-type: application/json' \
     -d '{"weight_kg": 8000}'          # park here, reported stable
curl -X POST localhost:3100/simulator/resume -d '{"target_kg": 20000}'
curl localhost:3100/simulator          # current phase and target
```

Swapping in the real indicator is a config change, not a code change: set
`SERIAL_PATTERN` to a named-group regex (`weight`, optionally `status` and
`unit`) plus the baud/framing settings. The default pattern already handles the
two common shapes — `ST,GS,+  1234.5kg` and a bare `+0012345`.

## Key domain rules

- **Net weight is `|first − second|`.** The absolute value is deliberate: a
  truck may arrive empty and leave loaded, or arrive loaded and leave empty.
  Both are ordinary and both yield the same material weight.
- **1 maund = 40 kg**, **1 ton = 1000 kg**. Every completion screen and receipt
  shows all three units.
- **Store UTC, display Asia/Karachi.** Reports filter on `first_weight_at`, the
  real event time — never on sync time, so a batch that uploads after an outage
  does not collapse into one moment.
- **Void, never delete.** Nothing is hard-deleted; voided tickets are excluded
  from revenue.
- **Sync is idempotent**, an upsert keyed on the record's UUID. Re-sending a
  batch can never duplicate it.

## Build status

| Milestone | Scope                                                  | Status  |
| --------- | ------------------------------------------------------ | ------- |
| M0        | Monorepo, `shared`, `ui`, theme, tooling               | ✅ Done |
| M1        | Agent: serial reader, simulator, SQLite, local API     | ✅ Done |
| M2        | Operator app: first-weight flow                        | ✅ Done |
| M3        | Operator app: second weight, completion, void, reprint | ✅ Done |
| M4        | Receipt design & printing (soft/hard forms, QR)        | ✅ Done |
| M5        | Cloud API + MongoDB + QR receipt routes                | ✅ Done |
| M6        | Sync engine (outbox)                                   | ✅ Done |
| M7        | Manager dashboard                                      | ✅ Done |
| M8        | PWA polish, Windows packaging, settings                | ✅ Done |
| M9        | End-to-end QA, README, operator manual                 | ✅ Done |

## Checking the whole thing works

```bash
pnpm test                  # every unit and integration suite
./scripts/end-to-end.sh    # the whole product, one truck, end to end
```

The end-to-end script starts MongoDB, the cloud server, the agent on its
simulator and a headless browser, then drives a single truck through every
flow: weigh in → weigh out → receipts → sync → dashboard → the QR page a driver
scans → PDF → reprint → void → audit trail. It needs Node 20+ and Chrome, and
**no weighbridge hardware and no internet**.

## Still needed from the client

Placeholders are in place for all of these; swapping them in is a config change,
not a code change.

- Company logo and brand colours (the accent lives in one CSS variable)
- Receipt header/footer details: address, contact numbers, registration numbers
- Confirmed pricing per vehicle type
- Printer model, pad paper size, and the blank central area's dimensions
- Indicator protocol: brand/model, baud rate, framing, weight string format,
  and whether it reports a stability flag
