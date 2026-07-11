<div align="center">

# ✉️ Payroll Mail Service

> **Send personalised, password-protected payslips to your whole team — safely, in batches, from a single page**

![Node.js](https://img.shields.io/badge/Node.js-5FA04E?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)

[Features](#-features) • [Quick Start](#-quick-start) • [Payslips](#-personalised-payslip-sender) • [Configuration](#️-configuration) • [How It Works](#-how-it-works) • [Troubleshooting](#-troubleshooting)

</div>

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 📋 **CSV Recipients** | Upload any CSV with an `email` column — extra columns become template variables |
| ✍️ **Personalisation** | Use `{name}`, `{department}`, or any CSV column in subject and body |
| 📎 **Attachment** | Attach one file (PDF, etc.) up to 25 MB — same file goes to everyone |
| 🐢 **Batched Sending** | Configurable batch size + pause between batches — never hammers the mail server |
| ⏰ **Scheduling** | Set a future start time or send immediately |
| 🛟 **Daily Cap** | Rolling 24-hour send limit keeps you inside Gmail / Workspace quotas |
| 🔁 **Crash-Safe Resume** | SQLite-backed — restarts pick up exactly where they left off |
| 📊 **Live Dashboard** | Sent / pending / failed counts, progress bar, pause / resume / stop / retry |
| 🔒 **UI Password** | Optional `APP_PASSWORD` locks the web UI for cloud deployments |
| 📋 **Payslip Sender** | AI-matched, NI-password-protected, per-recipient PDF payslips |

---

## 📋 Prerequisites

| Requirement | Version |
|-------------|---------|
| Docker | 20+ (recommended) |
| Node.js | 20+ (without Docker) |
| Gmail / Workspace | App Password required |

### Gmail Sending Limits

| Account Type | Daily Limit |
|---|---|
| Google Workspace | ~2,000 recipients/day |
| Free @gmail.com | ~500 recipients/day |

---

## 🚀 Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/CaputoDavide93/Payroll-Mail-Service.git
cd Payroll-Mail-Service
```

### 2. Configure Environment (optional)

```bash
cp .env.example .env
# Edit .env with your SMTP credentials and a strong APP_PASSWORD
```

### 3. Run with Docker

```bash
docker compose up -d --build
```

### 4. Open the App

Navigate to **http://localhost:3000** and click **⚙️ Settings** to enter your Gmail App Password.

To stop: `docker compose down` — your data survives in the `mail-data` Docker volume.

### Run Without Docker

```bash
npm install
npm start
# open http://localhost:3000
```

---

## 📧 Sending Campaigns

### 1. One-Time Gmail Setup (App Password)

> App Passwords require **2-Step Verification** to be enabled on your Google account.

1. Enable 2-Step Verification: https://myaccount.google.com/signinoptions/twosv
2. Create an App Password: https://myaccount.google.com/apppasswords
   - Name it *Payroll Mail Service* → **Create**
   - Copy the 16-character password shown
3. Paste it into **⚙️ Settings** in the app

### 2. Prepare Your Recipients CSV

```csv
name,email,department
Alice Smith,alice@example.com,Engineering
Bob Jones,bob@example.com,Finance
```

- `email` is required; `name` is recommended
- Any extra column (`department`, `location`, etc.) can be used as `{department}` in the email
- Duplicate or invalid emails are skipped and reported

A ready-to-edit `sample-recipients.csv` is included.

### 3. Create and Send

1. Fill in **New send**: campaign name, subject, body (use `{name}` for the greeting)
2. Upload your **CSV** and optional **attachment** (PDF, etc., up to 25 MB)
3. Set **batch size** (10 is safe) and **interval** (60 s is gentle)
4. Optionally set a **schedule start** time, or tick **"Create without sending (draft)"**
5. Click **Create & send** — you can close the browser, sending continues on the server

Use **Send preview** on any campaign to email yourself the rendered message with the real attachment before it goes to 600 people.

---

## 📋 Personalised Payslip Sender

A dedicated workflow for sending each employee their own password-protected PDF payslip.

### How It Works

| Step | What Happens |
|------|-------------|
| **1. Upload** | Upload the employee Excel file + a ZIP of all payslip PDFs |
| **2. AI Match** | Claude AI + fuzzy matching pairs each PDF to the right employee by name |
| **3. Protect** | Each PDF is encrypted with the employee's NI number as the password (256-bit AES via `qpdf`) |
| **4. Pre-flight** | Optional AI review flags suspicious pairings before a single email is sent |
| **5. Send** | A per-recipient campaign is created — each person gets only their own payslip |
| **6. Cleanup** | Delete all PDFs and match data from the server when done |

### Excel Format

| Column | Notes |
|--------|-------|
| `EENo` | Employee number |
| `FullName` | Used for PDF matching |
| `NI No` | Used as the PDF password — never stored or logged |
| `Email Address` | Delivery address |

### Security Notes

- NI numbers are **never** stored, logged, or returned by any API — used only at the moment of PDF encryption
- Raw (unprotected) PDFs are deleted from disk as soon as protection completes
- The Anthropic API key can be provided via `ANTHROPIC_API_KEY` or in Settings — stored locally, never echoed back to the UI
- Full data-handling policy and vulnerability reporting: [SECURITY.md](SECURITY.md)

### Navigate to Payslips

Click **📋 Payslips** in the top navigation bar of the app.

---

## ⚙️ Configuration

Set in **⚙️ Settings** in the UI, or seed via environment variables. Copy `.env.example` to `.env` — Docker Compose reads it automatically.

| Variable | Purpose | Default |
|----------|---------|---------|
| `SMTP_HOST` | Mail server hostname | `smtp.gmail.com` |
| `SMTP_PORT` | `465` (SSL) or `587` (STARTTLS) | `465` |
| `SMTP_USER` | Gmail / Workspace login address | – |
| `SMTP_PASS` | App Password | – |
| `FROM_EMAIL` | Address shown as sender | `SMTP_USER` |
| `FROM_NAME` | Name shown as sender | – |
| `DAILY_LIMIT` | Max emails per rolling 24 h | `1800` |
| `APP_PASSWORD` | Locks the web UI (recommended on cloud) | – (off) |
| `ANTHROPIC_API_KEY` | Enables AI matching + pre-flight check for payslips | – (off) |
| `PORT` | Port to serve on | `3000` |
| `DATA_DIR` | Database + uploads location | `data` (`/data` in Docker) |

---

## 🌐 Hosting on a Cloud Server

The app is a single container — deploy it anywhere Docker runs. Close your laptop and batches keep sending on schedule.

### Any Linux Server (VPS, EC2, etc.)

```bash
# 1. Install Docker
sudo apt-get update && sudo apt-get install -y docker.io git   # Debian/Ubuntu
# or: sudo dnf install -y docker git                           # Amazon Linux / RHEL

sudo systemctl enable --now docker
sudo usermod -aG docker $USER   # log out/in after this

# 2. Deploy the app
git clone https://github.com/CaputoDavide93/Payroll-Mail-Service.git payroll-mail
cd payroll-mail
cp .env.example .env
nano .env   # set SMTP_USER, SMTP_PASS, FROM_EMAIL, FROM_NAME, APP_PASSWORD
docker compose up -d --build
```

**Access via SSH tunnel** (simplest — no public port needed):

```bash
ssh -L 3000:localhost:3000 user@<server-ip>
# open http://localhost:3000 on your laptop
```

For team access, put Caddy or Nginx in front on port 443 for automatic HTTPS.

> **Security:** Always set `APP_PASSWORD` on any internet-facing server — without it the API is fully open.

---

## 📬 Deliverability — Staying Out of Spam

Sending hundreds of near-identical emails is exactly what spam filters watch for. Work through this checklist once with whoever manages your DNS:

- [ ] **SPF** — TXT record authorising Google to send: `v=spf1 include:_spf.google.com ~all`
- [ ] **DKIM** — enable in Google Admin (*Apps → Gmail → Authenticate email*) and publish the key
- [ ] **DMARC** — start gentle: `v=DMARC1; p=none; rua=mailto:you@yourdomain.com`
- [ ] **Test first** — send a preview to a Gmail *and* an Outlook address before the full blast
- [ ] **Keep From on your domain** — don't send "as" an outside address
- [ ] **Real text in the body** — not just an image; include a contact or unsubscribe line
- [ ] **Warm up gently** — default 10-per-batch with 60 s gap spreads 600 over ~1 hour

---

## 🔍 How It Works

- **Backend:** Node.js + Express. SMTP via `nodemailer`.
- **State:** Single SQLite file (`better-sqlite3`) under `DATA_DIR` holds settings, campaigns, and every recipient's status — what makes crash-safe resume possible.
- **Worker:** Background loop wakes every 2 s, promotes scheduled campaigns, sends the next batch (respecting the pause and daily cap), retries each failed send up to 3 times, and marks the campaign *completed* when the queue is empty.
- **Atomic claim:** Before sending a batch, recipients are marked `sending` in a single transaction — a crash can't cause double-sends; the startup hook resets `sending → pending`.
- **Payslips:** AI + fuzzy name matching, `qpdf` 256-bit AES encryption, raw PDFs deleted immediately after protection, NI numbers never persisted.
- **Frontend:** Static HTML/CSS/JS — no build step.

---

## 📁 Project Layout

```
server.js                 Express app + API routes
src/db.js                 SQLite schema + migrations
src/settings.js           SMTP settings (env seeding, secret masking)
src/mailer.js             Transport, template rendering, sending
src/parseRecipients.js    CSV parsing & validation
src/campaigns.js          Campaign / recipient queries
src/worker.js             Background batch-sending loop
src/preparePayslips.js    Payslip pipeline (match → protect → manage)
src/matchAttachments.js   AI + fuzzy PDF-to-employee matching
public/                   Web UI (campaigns + payslips pages)
Dockerfile
docker-compose.yml
.env.example
```

---

## ⚠️ Notes & Limitations

- **Delivery is "at least once."** A recipient is marked *sent* only after the mail server accepts it. If the process is killed in the tiny window between acceptance and the DB write, that one recipient may get the email twice on restart. For payroll, a duplicate is far less harmful than a missed payslip.
- **App Password stored in SQLite** under `DATA_DIR`. Treat that volume as a secret and rotate the password in your Google account if it's ever exposed.
- **Five wrong UI-password attempts** from one IP triggers a one-minute lockout.
- **One attachment per standard campaign**, up to 25 MB. Payslips use per-recipient attachments with no size limit beyond disk space.
- **Daily limit is a rolling 24-hour window**, not a calendar day.

---

## 🐛 Troubleshooting

<details>
<summary>❌ Emails not sending — "Missing SMTP configuration"</summary>

Open **⚙️ Settings**, fill in all SMTP fields, and click **Save**. Then use **Send test** to confirm the connection works before creating a campaign.
</details>

<details>
<summary>❌ Test email goes to spam</summary>

Check SPF, DKIM, and DMARC are configured on your domain (see [Deliverability](#-deliverability--staying-out-of-spam)). DKIM is the most important one.
</details>

<details>
<summary>❌ Payslip preparation fails — "qpdf is not installed"</summary>

`qpdf` is included in the Docker image. If running without Docker, install it:

```bash
# Debian / Ubuntu
sudo apt install qpdf

# macOS
brew install qpdf
```
</details>

<details>
<summary>❌ No AI matching — payslips only use fuzzy match</summary>

Set the `ANTHROPIC_API_KEY` environment variable in your `.env` file and rebuild the container, or paste the key in **Settings** (it's stored locally and never echoed back).
</details>

<details>
<summary>❌ Container starts but UI shows a blank page</summary>

```bash
docker logs payroll-mail-service
```

Check for port conflicts (something else on 3000) or missing env vars.
</details>

<details>
<summary>❌ Data lost after docker compose down</summary>

Data lives in the `mail-data` Docker volume. `docker compose down` preserves it. Only `docker compose down -v` removes it.
</details>

---

## 🤝 Contributing

Contributions are welcome! Please open an issue first to discuss large changes.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

<div align="center">

## 👤 Author

**Davide Caputo**

[![GitHub](https://img.shields.io/badge/GitHub-CaputoDavide93-181717?style=for-the-badge&logo=github)](https://github.com/CaputoDavide93)

---

⭐ **If this tool helped you, please give it a star!** ⭐

<sub>Made with ❤️ by Davide Caputo</sub>

</div>
