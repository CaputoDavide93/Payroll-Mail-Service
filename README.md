# Payroll Mail Service

Send a personalized email with one attachment to a large list of people
(600+), safely in scheduled batches, through a Gmail / Google Workspace
account.

The sending happens **on the server in the background**, so once you press
*Create & send* you can **close the browser or shut your laptop's browser
tab** — it keeps going. If the server restarts or crashes mid-send, it
**picks up exactly where it left off** (no skipped or duplicated emails).

It's built for a non-technical operator: one simple page to upload your
list, attach the PDF, write the greeting, and watch a progress bar.

---

## What it does

- 📋 Upload recipients from a **CSV** (an `email` column is required; a
  `name` column is recommended).
- ✍️ Write the email once and personalize it with `{name}` (or any other
  CSV column, e.g. `{department}`).
- 📎 Attach **one file** (PDF, etc.) that goes to everyone — up to 25 MB.
- 🐢 Send in **batches** (default 10 at a time) with a configurable pause
  between batches, so you never hammer the mail server.
- ⏰ **Schedule** a start time, or send immediately.
- 🛟 Stays under a **daily send limit** so you don't trip Gmail's caps.
- 📊 Live **dashboard**: sent / pending / failed, with pause, resume, stop,
  and **retry-failed**.

> **Sending limits:** Google Workspace allows roughly **2,000 recipients/day**,
> so all 600 send comfortably in one run. A free `@gmail.com` account is
> capped at ~**500/day** — keep the daily limit at 500 and the service will
> automatically pause and finish the rest the next day.

---

## 1. One-time Gmail / Workspace setup (App Password)

You need an **App Password** (a 16-character password just for this app).
This requires 2-Step Verification to be on.

1. Turn on **2-Step Verification**: <https://myaccount.google.com/signinoptions/twosv>
2. Create an App Password: <https://myaccount.google.com/apppasswords>
   - Name it e.g. *Payroll Mail Service* and click **Create**.
   - Copy the 16-character password it shows (spaces don't matter).
3. You'll paste this into the app's **Settings** screen later.

*(Workspace admins: make sure "Less secure app access" isn't required — App
Passwords work as long as 2-Step Verification is enabled for the account.)*

---

## 2. Run it

You only need [Docker](https://www.docker.com/products/docker-desktop/)
installed. The same command works on your laptop or any cloud server.

```bash
# from the project folder
docker compose up -d --build
```

Then open **<http://localhost:3000>** in your browser.

To stop it: `docker compose down`. Your data (settings, campaigns, progress)
is kept in a Docker volume, so it survives restarts and upgrades.

### Run without Docker (alternative)

Requires Node.js 20+.

```bash
npm install
npm start
# open http://localhost:3000
```

---

## 3. Use it

1. Click **⚙️ Settings** (it opens automatically the first time):
   - Enter your Gmail/Workspace address and the **App Password**.
   - Set **From name** (what recipients see, e.g. *Payroll Team*).
   - Click **Save settings**, then **Send test** to your own address to
     confirm it works.
2. Fill in **New send**:
   - Campaign name, subject, and body (use `{name}` where the greeting goes).
   - Upload your recipients **CSV** and the **attachment**.
   - Set the **batch size** (10 is a safe default) and the **seconds between
     batches** (60 is gentle).
   - Optionally set a **schedule start** time. Leave blank to start now.
3. Click **Create & send**. Watch the progress bar in **Sends**.
   You can now close the page — sending continues on the server.

### Recipients CSV format

```csv
name,email,department
Alice Smith,alice@example.com,Engineering
Bob Jones,bob@example.com,Finance
```

- `email` is required. `name` is matched case-insensitively (also accepts
  `first name`, `full name`, etc.).
- Any extra column (like `department`) can be used in the email as
  `{department}`.
- Invalid or duplicate emails are skipped automatically and reported back.

A ready-to-edit `sample-recipients.csv` is included.

---

## Hosting on a cloud server (so it runs 24/7)

The app is a single container — deploy it anywhere that runs Docker (a small
AWS EC2 instance, Render, Fly.io, a DigitalOcean droplet, etc.):

1. Copy the project to the server and run `docker compose up -d --build`.
2. **Protect the UI with a password** by setting `APP_PASSWORD` (see below) —
   important on a public server, since anyone who reaches the page could send
   email from your account.
3. Put it behind HTTPS (your host's load balancer, or a reverse proxy like
   Caddy/Nginx) if it's internet-facing.

Because it runs on the server, you can close your laptop entirely and the
batches keep sending on schedule.

---

## Configuration (optional environment variables)

Everything can be set in the **Settings** screen, but you can also seed it
via environment variables. Copy `.env.example` to `.env` and fill it in;
`docker compose` reads it automatically.

| Variable | Purpose | Default |
|---|---|---|
| `SMTP_HOST` | Mail server | `smtp.gmail.com` |
| `SMTP_PORT` | `465` (SSL) or `587` (STARTTLS) | `465` |
| `SMTP_USER` | Gmail/Workspace login address | – |
| `SMTP_PASS` | **App Password** | – |
| `FROM_EMAIL` | Address shown as sender | `SMTP_USER` |
| `FROM_NAME` | Name shown as sender | – |
| `DAILY_LIMIT` | Max emails per rolling 24h | `1800` |
| `APP_PASSWORD` | Protect the web UI (recommended for cloud) | – (off) |
| `PORT` | Port to serve on | `3000` |
| `DATA_DIR` | Where the database + uploads live | `data` (`/data` in Docker) |

---

## How it works (for the curious)

- **Backend:** Node.js + Express. SMTP via `nodemailer`.
- **State:** a single SQLite file (`better-sqlite3`) under `DATA_DIR` holds
  settings, campaigns, and every recipient's status. This is what makes
  restarts safe.
- **Worker:** a background loop wakes every 2 seconds, promotes scheduled
  campaigns whose time has come, sends the next batch for any *running*
  campaign (respecting the between-batch pause and the daily limit), retries
  each failed send up to 3 times, and marks the campaign *completed* when the
  queue is empty. Closing the UI doesn't touch it.
- **Frontend:** one static HTML/CSS/JS page — no build step.

## Project layout

```
server.js                 Express app + API routes
src/db.js                 SQLite schema
src/settings.js           SMTP settings (with env seeding)
src/mailer.js             Transport, template rendering, sending
src/parseRecipients.js    CSV parsing & validation
src/campaigns.js          Campaign/recipient queries
src/worker.js             Background batch-sending loop
public/                   The web UI
Dockerfile, docker-compose.yml
```
