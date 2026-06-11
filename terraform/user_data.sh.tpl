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

# ── Docker Compose + Buildx (AL2023 ships outdated versions) ───────────────
curl -SL https://github.com/docker/compose/releases/download/v2.32.4/docker-compose-linux-x86_64 -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose
mkdir -p /usr/lib/docker/cli-plugins
curl -SL https://github.com/docker/buildx/releases/download/v0.23.0/buildx-v0.23.0.linux-amd64 -o /usr/lib/docker/cli-plugins/docker-buildx
chmod +x /usr/lib/docker/cli-plugins/docker-buildx

# ── Wait for secrets to be populated in Secrets Manager ───────────────────
# Retries every 30 s for up to 60 minutes.
# Fill in the secret at:
#   AWS Console → Secrets Manager → payroll-mail-service/${environment}/config → Edit
echo "Waiting for secrets to be populated in Secrets Manager (secret: ${secret_arn})..."

for i in $(seq 1 120); do
  SECRET=$(aws secretsmanager get-secret-value \
    --secret-id "${secret_arn}" \
    --query SecretString \
    --output text \
    --region "${aws_region}" 2>/dev/null || echo "{}")

  SMTP_PASS=$(echo "$SECRET" | jq -r '.SMTP_PASS // empty')
  APP_PASSWORD=$(echo "$SECRET" | jq -r '.APP_PASSWORD // empty')

  if [ -n "$SMTP_PASS" ] && [ -n "$APP_PASSWORD" ]; then
    echo "Secrets populated — proceeding with setup."
    break
  fi

  echo "Attempt $i/120: secrets not yet set, retrying in 30 s..."
  sleep 30

  if [ "$i" -eq 120 ]; then
    echo "ERROR: secrets never populated after 60 minutes. Aborting."
    exit 1
  fi
done

# ── Clone app ──────────────────────────────────────────────────────────────
APP_DIR="/opt/payroll-mail"
if [ -d "$APP_DIR" ]; then
  echo "App directory exists, pulling latest..."
  git -C "$APP_DIR" pull
else
  git clone --branch "${git_branch}" "${git_repo_url}" "$APP_DIR"
fi
cd "$APP_DIR"

# ── Write .env from secret values ─────────────────────────────────────────
cat > .env <<EOF
SMTP_HOST=$(echo "$SECRET" | jq -r '.SMTP_HOST // "smtp.gmail.com"')
SMTP_PORT=$(echo "$SECRET" | jq -r '.SMTP_PORT // "465"')
SMTP_USER=$(echo "$SECRET" | jq -r '.SMTP_USER')
SMTP_PASS=$(echo "$SECRET" | jq -r '.SMTP_PASS')
FROM_EMAIL=$(echo "$SECRET" | jq -r '.FROM_EMAIL')
FROM_NAME=$(echo "$SECRET" | jq -r '.FROM_NAME // "Payroll Team"')
DAILY_LIMIT=$(echo "$SECRET" | jq -r '.DAILY_LIMIT // "1800"')
APP_PASSWORD=$(echo "$SECRET" | jq -r '.APP_PASSWORD')
ANTHROPIC_API_KEY=$(echo "$SECRET" | jq -r '.ANTHROPIC_API_KEY // ""')
DATA_DIR=/data
PORT=3000
EOF

chmod 600 .env
unset SECRET SMTP_PASS APP_PASSWORD

# ── Start ──────────────────────────────────────────────────────────────────
docker-compose up -d --build

PUBLIC_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 || echo "unknown")
echo "=== Bootstrap complete — app running on http://$PUBLIC_IP:3000 ==="
