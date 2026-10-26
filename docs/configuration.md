# ⚙️ Configuration

Settings can be entered in **Settings** in the web UI, or seeded through environment
variables. Copy `.env.example` to `.env` for Docker Compose, which passes the variables
below into the container. `npm start` does not read `.env`, so export them in your shell.

Seeding happens on first boot only, and only while SMTP user and password are not yet
saved. After that, the UI is the source of truth for the SMTP settings.

| Variable | Purpose | Default |
|---|---|---|
| `SMTP_HOST` | Mail server hostname | `smtp.gmail.com` |
| `SMTP_HOST_ALLOWLIST` | SMTP hosts the UI may use, comma-separated. `*` allows any host, for local development only | `smtp.gmail.com,smtp-relay.gmail.com` |
| `SMTP_PORT` | `465` (SSL) or `587` (STARTTLS) | `465` |
| `SMTP_SECURE` | Seed only. `false` forces STARTTLS. Unset derives it from the port (465 means SSL). Compose does not pass it through | derived from the port |
| `SMTP_USER` | Gmail or Workspace login address | none |
| `SMTP_PASS` | App Password | none |
| `FROM_EMAIL` | Address shown as the sender | `SMTP_USER` |
| `FROM_NAME` | Name shown as the sender | none |
| `DAILY_LIMIT` | Maximum emails per rolling 24 hours | `1800` |
| `APP_PASSWORD` | Locks the web UI. Set it on any server | none (off) |
| `ANTHROPIC_API_KEY` | Enables AI matching and the pre-flight review | none (off) |
| `PAYSLIP_DELETE_AFTER_SEND` | Delete each protected PDF once sent | `true` |
| `PAYSLIP_RETENTION_DAYS` | Delete whole payslip runs this many days after preparation. `0` means never. Runs still sending are kept | `7` |
| `TRUST_PROXY` | Set to `1` behind one reverse proxy so login throttling sees real client addresses and HSTS is sent over HTTPS | none (off) |
| `PORT` | Port to serve on. Compose publishes the same port on the host | `3000` |
| `DATA_DIR` | Database and uploads location. Docker pins it to `/data`, the `mail-data` volume | `data` |

On AWS, the secret's values, including `ANTHROPIC_API_KEY`, reach the container through
the `.env` that the instance's boot script writes. See [deployment.md](deployment.md).

A test checks that every variable the code reads appears in `.env.example`.
