# 🛠️ Troubleshooting

Find your symptom, then follow the fix. If none fits, open an
[Environment report](../CONTRIBUTING.md#reporting-an-environment) issue.

## Emails are not sending: "SMTP is not configured yet"

Open **Settings**, fill in every SMTP field, and press **Save settings**. Then press
**Send test** to confirm the connection before you create a campaign.

## "SMTP host ... is not allowed"

The host is not on `SMTP_HOST_ALLOWLIST`. Add it, comma-separated: export the variable
in your shell for `npm start`, put it in `.env` for Docker Compose, or set
`smtp_host_allowlist` in `terraform.tfvars` on AWS. Then restart.

## The test email goes to spam

Check SPF, DKIM and DMARC on your sending domain, see
[deliverability.md](deliverability.md). DKIM is the most important one.

## Payslip preparation fails: "qpdf is not installed"

`qpdf` is included in the Docker image. Without Docker, install it:

```bash
sudo apt install qpdf     # Debian or Ubuntu
brew install qpdf         # macOS
```

## Payslips match only by fuzzy name, with no AI matching

AI matching needs an API key for the external AI service. Paste it in **Settings**, or set
`ANTHROPIC_API_KEY`: exported in your shell for `npm start`, in `.env` for Docker
Compose, or in the Secrets Manager secret on AWS.

## "payslip files in this run have already been sent or expired"

Protected PDFs are deleted after sending, and runs expire after
`PAYSLIP_RETENTION_DAYS`. Upload the Excel sheet and ZIP again to prepare a fresh run.

## The container starts but the UI is blank

```bash
docker logs payroll-mail-service
```

Look for a port clash (something else on 3000) or missing variables.

## `npm ci` fails while building `better-sqlite3`

Use Node.js 22. A build on Node 26 failed here. Check with `node -v`.

## Data is gone after `docker compose down`

Data lives in the `mail-data` volume. `docker compose down` keeps it. Only
`docker compose down -v` removes it.

## "Too many attempts. Wait a minute and try again."

Five wrong UI passwords from one address trigger a one-minute lockout. Wait, then retry.
Behind a reverse proxy, set `TRUST_PROXY=1` so the lockout applies to the real client
address and not to the proxy.
