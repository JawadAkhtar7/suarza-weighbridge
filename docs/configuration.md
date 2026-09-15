# Configuration guide

Written for whoever deploys and maintains the system.

Every value lives in an environment variable or in the operator app's Settings.
Real values belong only in `.env` files, which are git-ignored; the repo ships
`.env.example` for each app.

---

## The two halves

|            | Runs on                           | Owns                                                           |
| ---------- | --------------------------------- | -------------------------------------------------------------- |
| **Agent**  | The Windows PC at the weighbridge | The scale, the local database, the operator app                |
| **Server** | A DigitalOcean droplet            | MongoDB Atlas, the manager dashboard, the public receipt pages |

They meet at exactly one place: the agent POSTs finished records to the server's
`/ingest`, authenticated with a shared key. **The agent never holds a database
credential** — a compromised factory PC can push weighments and nothing else.

---

## Agent — `apps/agent/.env`

```dotenv
PORT=3100                 # Operator app + local API. Bound to 127.0.0.1 only.
STATION_ID=A              # Stamped on every record. Only matters with >1 bridge.
DATABASE_PATH=./data/weighbridge.sqlite

# --- The indicator -------------------------------------------------------
SERIAL_PORT=COM3          # Device Manager → Ports (COM & LPT)
SERIAL_BAUD_RATE=9600
SERIAL_DATA_BITS=8
SERIAL_STOP_BITS=1
SERIAL_PARITY=none
SERIAL_DELIMITER=\r\n     # Line framing
SERIAL_PATTERN=           # Blank = the built-in pattern; see below
SERIAL_UNIT=kg            # kg | g | lb | t — readings are normalised to kg
READING_STALE_MS=3000     # Older than this and the indicator counts as silent

USE_SIMULATOR=false       # true runs a realistic fake scale, no hardware needed

# --- Cloud ---------------------------------------------------------------
CLOUD_API_URL=https://weighbridge.example.com
CLOUD_API_KEY=            # Must equal the server's INGEST_API_KEY
SYNC_INTERVAL_SECONDS=180 # A backstop only; records sync the moment they save
```

Leaving `CLOUD_API_URL` or `CLOUD_API_KEY` blank runs the agent purely offline,
which is a valid way to work — records queue until it is configured.

### Fitting the real indicator

The client has not yet supplied the protocol spec, so the parser is driven by
config. The built-in pattern already reads the two common shapes:

```
ST,GS,+  1234.5kg     status, gross/net mode, value
+0012345              a bare signed value
```

For anything else, set `SERIAL_PATTERN` to a regular expression with a named
`weight` group, optionally `status` and `unit`. For a protocol like `W18500|OK`:

```dotenv
SERIAL_PATTERN=^W(?<weight>\d+)\|(?<status>OK|MOVING)$
```

**That is the whole change.** Nothing else in the system needs touching — that
is what the simulator existed to guarantee.

---

## Server — `apps/server/.env`

```dotenv
# One variable, database name included. Without the /suarzaweightbridge on the
# end, Mongoose connects to the cluster default instead of our data — silently.
# The server refuses to start if it is missing.
MONGODB_URI=mongodb+srv://<user>:<password>@cluster0.wrxrpup.mongodb.net/suarzaweightbridge

APP_DOMAIN=https://weighbridge.example.com   # Builds the QR receipt URLs
PORT=4000
NODE_ENV=production

JWT_SECRET=          # openssl rand -base64 48
JWT_EXPIRES_IN=12h
INGEST_API_KEY=      # openssl rand -hex 32 — must equal the agent's CLOUD_API_KEY

COMPANY_NAME=Suarza International
COMPANY_ADDRESS=
COMPANY_PHONE=
COMPANY_LOGO_URL=
```

> ### Company details are set in two places
>
> The `COMPANY_*` variables here brand the **public receipt page and the PDF**.
> The same details are also in the operator app's Settings, where they brand the
> **on-screen preview**.
>
> They ship identical, but if you change one and not the other, a customer's
> downloaded PDF will disagree with what the operator saw. **Change both.**
>
> (The agent cannot read the server's values — it has to work with no internet —
> and the server cannot read the agent's, because a driver may scan a QR while
> the weighbridge PC is switched off.)

---

## Settings, in the app

These live in the agent's database, not in `.env`, and are edited from the gear
icon in the operator app. They survive a cleared browser profile and are the
same in every browser on that PC.

| Setting                             | Notes                                                          |
| ----------------------------------- | -------------------------------------------------------------- |
| Paper size, top/left offsets, scale | Calibrated once per printer with **Test print**                |
| Auto-print after saving             | On by default                                                  |
| Company name, address, phone, logo  | The on-screen preview and the QR page's branding               |
| Receipt web address                 | Must match the server's `APP_DOMAIN`, or the QR points nowhere |
| Pricing per vehicle type            | The rate that auto-fills; the amount stays editable            |
| Station ID, sync interval           |                                                                |
| Backup folder and frequency         | Ideally a different drive or a USB stick                       |

---

## MongoDB Atlas

1. **Network Access** must allow the droplet's public IP, and your own IP if you
   want to connect from a laptop. This is the most common cause of a server that
   starts and then times out.
2. **Database Access** — one user with read/write on `suarzaweightbridge`.
3. If the password is ever shared in plaintext — chat, email, a pasted config —
   rotate it: _Database Access_ → edit user → _Edit Password_, then update
   `.env` on the droplet and anywhere else it is used.

---

## Droplet deployment

```bash
git clone <repo> && cd suarza-weighbridge
pnpm install
pnpm build
cp apps/server/.env.example apps/server/.env   # then fill it in

pnpm add -g pm2
pm2 start apps/server/dist/index.js --name suarza-server
pm2 save && pm2 startup        # survives a reboot
```

Put Nginx in front as a reverse proxy with a Let's Encrypt certificate. **HTTPS
is not optional** — manager logins and the QR receipt links both go over it.

The droplet is the client's to maintain: OS updates, and keeping PM2 alive.

---

## Default accounts

| Username   | Password   | Role             |
| ---------- | ---------- | ---------------- |
| `operator` | `operator` | Weighing screens |
| `manager`  | `manager`  | Dashboard        |
| `admin`    | `admin`    | Everything       |

Seeded on first boot and stored hashed. **Change them before the server is
reachable on the internet.** They are seeded only when missing, so editing a
password in the database is not undone by the next deploy.

---

## Checking a deployment

```bash
pnpm test              # every unit and integration suite
./scripts/end-to-end.sh   # the whole product, one truck, on the simulator
```

The end-to-end script needs Node 20+ and Chrome. It needs no weighbridge
hardware and no internet.
