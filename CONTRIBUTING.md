# 🤝 Contributing

Reports from environments the README does not list are the most useful contribution.

## Reporting an environment

Open an **Environment report** issue and say whether it worked. Include:

- operating system and CPU
- Docker version, or Node.js version and how `qpdf` was installed
- mail provider and SMTP port
- the output of `docker logs payroll-mail-service`, or your terminal if you run `npm start`

Remove NI numbers, real names, email addresses and payslips first. Do not attach
payslips, spreadsheets or the contents of your `.env` or `data/` directory.

## Reporting a bug

Open an issue with the steps to reproduce, what you expected, and what happened.
Security problems go through [SECURITY.md](SECURITY.md), not public issues.

## Changing code or docs

Open an issue first for large changes. Then:

```bash
npm ci
make check
```

`make check` runs the test suite (it needs `qpdf` on `PATH`), confirms the generated
diagrams are current, and runs `shellcheck` on `scripts/deploy.sh`. Retake screenshots
with `make screenshots` after a UI change. Keep commits small, with conventional
messages (`fix:`, `feat:`, `docs:`).
