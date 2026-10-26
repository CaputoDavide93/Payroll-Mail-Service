# 📋 Payslips

The payslip sender sends each employee their own password-protected PDF. Open it
from **Payslips** in the top bar. The click-by-click version is in
[setup.md](setup.md#5-run-a-payslip-batch).

## How a run works

| Step | What happens |
|---|---|
| 1. Upload | You upload the employee Excel file and a ZIP of all payslip PDFs |
| 2. Match | Fuzzy name matching pairs each PDF to an employee. With an API key for the external AI service set, an AI match runs first and fuzzy matching fills the gaps |
| 3. Protect | Each PDF is encrypted with the employee's NI number as the password, 256-bit AES through `qpdf` |
| 4. Pre-flight | Optional, needs an API key. A review flags suspicious pairings before any email goes out |
| 5. Send | A per-recipient campaign is created. Each person gets only their own payslip |
| 6. Clean up | Each protected PDF is deleted once sent. Runs expire after `PAYSLIP_RETENTION_DAYS`, or you can delete them by hand |

## Excel format

| Column | Notes |
|---|---|
| `EENo` | Employee number |
| `FullName` | Used for PDF matching |
| `NI No` | Used as the PDF password. Never stored or logged |
| `Email Address` | Delivery address |

A template is served at `/api/payslips/sample-excel` (the **download sample** link on step 1).

## What is and is not kept

- NI numbers are not stored, logged or returned by any API. They exist only while a
  PDF is being encrypted, and reach `qpdf` through a private argfile, not the command line.
- Raw PDFs are deleted as soon as protection finishes.
- Protected PDFs are deleted after sending when `PAYSLIP_DELETE_AFTER_SEND` is `true` (the default).
- Whole runs are purged `PAYSLIP_RETENTION_DAYS` days after preparation (7 by default, `0` never). Runs with unsent recipients are kept.
- ZIP uploads are capped at 500 files, 25 MB per PDF and 200 MB in total, to stop ZIP bombs.
- Preparation runs in a worker thread with a two-minute timeout, so a large upload cannot freeze the UI.
- Recipient addresses are not written to the send logs.

## AI matching and your data

AI matching and the pre-flight review are off unless you set `ANTHROPIC_API_KEY` or
paste a key in **Settings**. When on, recipient names, email addresses and payslip
filenames go to that service. Payslip contents and NI numbers never do. Without a
key, everything stays on your server and your SMTP provider. The full policy is in
[SECURITY.md](../SECURITY.md).
