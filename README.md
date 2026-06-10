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
   - Tip: tick **"Create without sending (draft)"** if you want to preview
     before it goes out.
3. Click **Create & send**. Watch the progress bar in **Sends**.
   You can now close the page — sending continues on the server.
4. **Preview before the blast:** on any send in the list, click **Send
   preview** to email yourself the *real* message — rendered greeting and the
   attachment — using the first recipient's data as the sample. This is the
   best way to catch a wrong `{placeholder}` or a missing attachment before it
   reaches 600 people.

You can **pause**, **resume**, **stop**, or **retry failed** recipients at any
time from the **Sends** list.

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

## Deliverability — staying out of spam

Sending 600 near-identical emails with the same attachment is exactly the
pattern spam filters watch for. Because you're on **Google Workspace with your
own domain**, the single biggest factor is your domain's email authentication.
Work through this once with whoever manages your DNS:

- [ ] **SPF** — a TXT record on your domain authorizing Google to send:
      `v=spf1 include:_spf.google.com ~all`
- [ ] **DKIM** — turn it on in the Google Admin console
      (*Apps → Google Workspace → Gmail → Authenticate email*) and publish the
      key Google gives you. This is the most important one.
- [ ] **DMARC** — a TXT record at `_dmarc.yourdomain.com`, start gentle:
      `v=DMARC1; p=none; rua=mailto:you@yourdomain.com`
- [ ] **Send the preview to a Gmail *and* an Outlook address** and confirm both
      land in the inbox, not spam.
- [ ] Keep the **From address on the same domain** as your DKIM/SPF (don't send
      "as" an outside address).
- [ ] Make sure the body has **real text** (not just an image), a clear subject,
      and ideally an unsubscribe/contact line — payroll mail is expected, but
      it still helps your domain reputation.
- [ ] First time at volume? **Warm up gently** — the default 10-per-batch with a
      60s gap spreads ~600 over ~1 hour, which looks far more natural than a
      burst.
- [ ] Clean the list — bounces from dead addresses hurt your reputation. The app
      reports failures so you can prune them.

If mail still lands in spam after DKIM/SPF/DMARC are green, it's almost always
the domain's sending reputation (new domain, or prior bulk sending) rather than
this app.

---

## Hosting on a cloud server (so it runs 24/7)

The app is a single container — deploy it anywhere that runs Docker. Because it
runs on the server, you can close your laptop entirely and the batches keep
sending on schedule.

**General steps (any host — Render, Fly.io, DigitalOcean, a VM):**

1. Copy the project to the server and run `docker compose up -d --build`.
2. **Protect the UI** by setting `APP_PASSWORD` (see below) — essential on a
   public server, since anyone who reaches the page could send email as you.
3. Put it behind **HTTPS** (your host's load balancer, or a reverse proxy like
   Caddy/Nginx) if it's internet-facing.

### Concrete example: AWS EC2 (free-tier eligible)

1. **Launch an instance:** EC2 → *Launch instance* → Amazon Linux 2023,
   `t3.micro` (or `t2.micro`). Create/download a key pair.
2. **Security group:** allow inbound **22** (SSH, ideally only from your IP) and
   **443** (HTTPS). Leave the app's port 3000 closed to the world — you'll reach
   it via a proxy on 443, or via an SSH tunnel.
3. **Connect and install Docker:**
   ```bash
   ssh -i your-key.pem ec2-user@<public-ip>
   sudo dnf update -y && sudo dnf install -y docker git
   sudo systemctl enable --now docker
   sudo usermod -aG docker ec2-user   # then log out/in so `docker` works without sudo
   ```
4. **Get the app and configure it:**
   ```bash
   git clone <your-repo-url> payroll-mail && cd payroll-mail
   cp .env.example .env
   nano .env          # set SMTP_USER, SMTP_PASS (App Password), FROM_EMAIL,
                      # FROM_NAME, and a strong APP_PASSWORD
   docker compose up -d --build
   ```
5. **Reach the UI safely.** Simplest for a single user — an SSH tunnel from your
   laptop (no public port, no proxy needed):
   ```bash
   ssh -i your-key.pem -L 3000:localhost:3000 ec2-user@<public-ip>
   # now open http://localhost:3000 on your laptop
   ```
   For team access instead, run a reverse proxy (Caddy gives you automatic
   HTTPS with a one-line config) on 443 in front of port 3000.
6. The container has `restart: unless-stopped`, so it comes back automatically
   if the instance reboots. Your data lives in the `mail-data` Docker volume.

> The app stores its database and attachments in a Docker volume, so
> `docker compose down && docker compose up -d` (e.g. to upgrade) keeps all your
> campaigns and progress.

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
- On shutdown (`docker compose down`, reboot) the worker finishes its current
  batch before exiting, so a send isn't cut off mid-flight.

## Notes & limitations

- **Delivery is "at least once."** A recipient is marked *sent* only after the
  mail server accepts it. If the process is killed in the rare window between
  the server accepting a message and that status being saved, that one
  recipient could get the email twice on restart. This is deliberate — for
  payroll, a duplicate is far less harmful than someone silently *not*
  receiving their payslip. The graceful-shutdown handler keeps this window tiny.
- **The App Password is stored in the SQLite database** (under `DATA_DIR`) so
  the service can keep sending unattended. Treat that volume as a secret:
  restrict access to the server, and rotate the App Password in your Google
  account if it's ever exposed.
- **Five wrong UI-password attempts** from one address triggers a one-minute
  lockout for that address — a deliberate brute-force speed bump.
- **One attachment per send**, up to 25 MB (Gmail's limit). The same file goes
  to everyone.
- **Daily limit is a rolling 24-hour window**, not a calendar day — set it to
  match your account (Workspace ~2000, free Gmail ~500).

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
