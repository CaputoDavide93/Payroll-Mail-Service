#!/bin/bash
set -euo pipefail
exec > /var/log/user-data.log 2>&1

echo "=== Payroll Mail Service bootstrap ==="

# ── System packages ────────────────────────────────────────────────────────
dnf update -y
dnf install -y docker git

# ── Docker ─────────────────────────────────────────────────────────────────
systemctl enable --now docker
usermod -aG docker ec2-user

# ── App ────────────────────────────────────────────────────────────────────
APP_DIR="/opt/payroll-mail"
git clone --branch "${git_branch}" "${git_repo_url}" "$APP_DIR"
cd "$APP_DIR"

# Write .env — secrets injected by Terraform templatefile()
cat > .env <<'ENV_EOF'
SMTP_HOST=${smtp_host}
SMTP_PORT=${smtp_port}
SMTP_USER=${smtp_user}
SMTP_PASS=${smtp_pass}
FROM_EMAIL=${from_email}
FROM_NAME=${from_name}
DAILY_LIMIT=${daily_limit}
APP_PASSWORD=${app_password}
ANTHROPIC_API_KEY=${anthropic_api_key}
DATA_DIR=/data
PORT=3000
ENV_EOF

chmod 600 .env

# ── Start ──────────────────────────────────────────────────────────────────
docker compose up -d --build

echo "=== Bootstrap complete — app running on http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4):3000 ==="
