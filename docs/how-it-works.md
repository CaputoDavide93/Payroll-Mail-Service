# ⚙️ How it works

## The pieces

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/architecture-dark.svg">
  <img src="assets/architecture-light.svg" width="100%"
       alt="The browser talks to the Express API, which keeps campaigns and recipients in SQLite under DATA_DIR and hands payslip preparation to a worker thread that can ask an external AI service to match PDFs and encrypts each with qpdf, while a send loop claims batches from SQLite every two seconds and sends them over SMTP.">
</picture>

- **Backend:** Node.js and Express. Mail goes out through `nodemailer`.
- **Frontend:** static HTML, CSS and JavaScript with no build step. It follows the system light or dark setting.
- **State:** one SQLite file (`better-sqlite3`) under `DATA_DIR` holds settings, campaigns and every recipient's status. That file is what makes crash-safe resume possible.
- **Image:** a multi-stage Node 22 build from the lockfile, running as the unprivileged `node` user.

## The send loop

A background loop wakes every 2 seconds. Each tick it promotes scheduled campaigns
whose start time has passed, picks the next running campaign whose pause has ended,
and sends one batch. It respects the pause between batches and the rolling daily cap.
Each failed send is retried up to 3 times with a growing delay. When the queue is
empty, the campaign is marked completed.

## Atomic claims

Before sending a batch, the loop marks those recipients `sending` in one database
transaction. If the process dies mid-batch, those rows are not sent again blindly:
at startup, any row left in `sending` is reset to `pending`. A recipient is marked
`sent` only after the mail server accepts the message.

## Payslip preparation

The Excel sheet and ZIP go to a worker thread, so the UI never freezes. The thread
matches names (AI first when a key is set, fuzzy matching otherwise, 30 second timeout
for the AI call), encrypts each PDF with `qpdf`, and deletes the raw PDF. Sending a
run creates one campaign with a different attachment per recipient. See
[payslips.md](payslips.md) for what is kept and for how long.

## Known limits

- **Delivery is at least once.** If the process is killed between the mail server accepting a message and the database write, that one recipient may get the email twice after a restart. For payroll, a duplicate is less harmful than a missed payslip.
- **The App Password is stored in SQLite** under `DATA_DIR`. Treat that volume as a secret and rotate the password in your Google account if it is ever exposed.
- **Changing the SMTP host** in Settings needs the password entered again, and only hosts on `SMTP_HOST_ALLOWLIST` are accepted.
- **Five wrong UI-password attempts** from one address trigger a one-minute lockout.
- **One attachment per standard campaign**, up to 25 MB. Payslip runs use one attachment per recipient, limited by disk space.
- **The daily limit is a rolling 24-hour window**, not a calendar day.
