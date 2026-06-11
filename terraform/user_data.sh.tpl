#!/bin/bash
set -euo pipefail
exec > /var/log/user-data.log 2>&1

echo "=== Payroll Mail Service bootstrap ==="

# ── System packages ────────────────────────────────────────────────────────
dnf update -y
dnf install -y docker git jq

# ── Docker ─────────────────────────────────────────────────────────────────
systemctl enable --now docker
usermod -aG docker ec2-user

# ── Fetch secrets from AWS Secrets Manager ─────────────────────────────────
echo "Fetching secrets from Secrets Manager..."
SECRET=$(aws secretsmanager get-secret-value \
  --secret-id "${secret_arn}" \
  --query SecretString \
  --output text \
  --region "${aws_region}")

# ── Clone app ──────────────────────────────────────────────────────────────
APP_DIR="/opt/payroll-mail"
git clone --branch "${git_branch}" "${git_repo_url}" "$APP_DIR"
cd "$APP_DIR"

# ── Write .env from secret values ─────────────────────────────────────────
# jq -r outputs raw strings (no quotes), safe for .env
cat > .env <<EOF
SMTP_HOST=$(echo "$SECRET" | jq -r '.SMTP_HOST')
SMTP_PORT=$(echo "$SECRET" | jq -r '.SMTP_PORT')
SMTP_USER=$(echo "$SECRET" | jq -r '.SMTP_USER')
SMTP_PASS=$(echo "$SECRET" | jq -r '.SMTP_PASS')
FROM_EMAIL=$(echo "$SECRET" | jq -r '.FROM_EMAIL')
FROM_NAME=$(echo "$SECRET" | jq -r '.FROM_NAME')
DAILY_LIMIT=$(echo "$SECRET" | jq -r '.DAILY_LIMIT')
APP_PASSWORD=$(echo "$SECRET" | jq -r '.APP_PASSWORD')
ANTHROPIC_API_KEY=$(echo "$SECRET" | jq -r '.ANTHROPIC_API_KEY')
DATA_DIR=/data
PORT=3000
EOF

chmod 600 .env

# Clear the secret from memory
unset SECRET

# ── Start ──────────────────────────────────────────────────────────────────
docker compose up -d --build

PUBLIC_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 || echo "unknown")
echo "=== Bootstrap complete — app running on http://$PUBLIC_IP:3000 ==="
