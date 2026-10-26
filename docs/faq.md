# ❓ FAQ

Short answers first. Setup is in [setup.md](setup.md), problems in
[troubleshooting.md](troubleshooting.md).

## What is Payroll Mail Service?

Payroll Mail Service is a free, open-source (MIT) web app you host yourself that emails each employee their own password-protected payslip PDF. It matches PDFs to people, encrypts each with the employee's NI number, and sends in batches that stay under Gmail and Google Workspace limits.

## Does it send ordinary bulk emails too?

Yes. A standard campaign takes a CSV with an `email` column, personalises the subject and body with any other column, and sends one shared attachment of up to 25 MB, using the same batching, daily cap and crash-safe resume.

## Where does my payroll data go?

Your server and your SMTP provider only, unless you opt in to AI matching. With an API key for the external AI service set, recipient names, email addresses and payslip filenames go to that service. Payslip contents and NI numbers never leave your server. See [payslips.md](payslips.md#ai-matching-and-your-data).

## Does it store NI numbers?

No. NI numbers are used only at the moment a PDF is encrypted and are never stored, logged or returned by any API. They reach `qpdf` through a private argfile, not the command line.

## How is each payslip protected?

Each PDF is encrypted with 256-bit AES through `qpdf`, using the employee's NI number as the open password. Anyone who knows the NI number can open that file, so treat it as a convenience layer, not as strong secrecy.

## Which Gmail limits apply?

Google sets them and can change them. At the time of writing, Google Workspace allows about 2,000 recipients a day and a free @gmail.com account about 500. Set `DAILY_LIMIT` below your figure. The default is 1800.

## Do I need an App Password?

Yes for Gmail and Workspace. Create one at <https://myaccount.google.com/apppasswords> with 2-Step Verification on. Your normal password will not work. Steps are in [setup.md](setup.md#2-create-a-gmail-app-password).

## Can I use a mail provider other than Gmail?

Possibly, but it is unverified. Any SMTP host on `SMTP_HOST_ALLOWLIST` can be entered in Settings, and the defaults are written for Gmail. If you try another provider, please send an environment report.

## What happens if the server restarts mid-send?

Sending resumes on its own. Rows left mid-send are reset to pending at startup and retried. In the rare case where a crash lands between the mail server accepting a message and the database write, that one recipient may get a duplicate.

## Can I close the browser while it sends?

Yes. Sending runs on the server. Reopen the page later to see progress.

## Can I schedule a send?

Yes. Set **Schedule start** on a campaign. The time is read in your browser's timezone, not the server's.

## Does it need Docker?

No. Docker is the recommended route, but `npm ci && npm start` works on Node.js 22 with `qpdf` installed.

## Is the web UI protected?

Only if you set `APP_PASSWORD`. Without it the UI and API are open to anyone who can reach the port, so always set it on a server.

## Does it work outside the UK?

The mail side does. The payslip side assumes a UK National Insurance number as the password and the four Excel columns listed in [payslips.md](payslips.md#excel-format).
