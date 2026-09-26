#!/bin/bash
# Idempotent: runs at first boot, and can be re-run on a live instance via SSM
# (fetch it from IMDS and pipe to bash) to pick up changes to this template.
set -euo pipefail
exec > >(tee -a /var/log/user-data.log) 2>&1

echo "=== Payroll Mail Service bootstrap ($(date -u +%FT%TZ)) ==="

# ── System packages ────────────────────────────────────────────────────────
dnf update -y
dnf install -y docker jq openssl

# ── Docker ─────────────────────────────────────────────────────────────────
systemctl enable --now docker
usermod -aG docker ec2-user

# ── Docker Compose (AL2023 ships an outdated version) ──────────────────────
if ! /usr/local/bin/docker-compose version 2>/dev/null | grep -q 'v2.32.4'; then
  curl -fSL https://github.com/docker/compose/releases/download/v2.32.4/docker-compose-linux-x86_64 -o /usr/local/bin/docker-compose
  chmod +x /usr/local/bin/docker-compose
fi

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

APP_DIR="/opt/payroll-mail"

# Reuse whatever volume currently holds /data (the SQLite DB + payslip runs). On the
# git-clone deploy it is payroll-mail_mail-data; never silently start on an empty one.
DATA_VOLUME=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' payroll-mail-service 2>/dev/null || true)
DATA_VOLUME="$${DATA_VOLUME:-payroll-mail_mail-data}"
docker volume create "$DATA_VOLUME" >/dev/null
echo "DATA_VOLUME=$DATA_VOLUME" > /etc/payroll-mail.conf
echo "Data volume: $DATA_VOLUME"

# ── Migrate from the old git-clone deploy ─────────────────────────────────
# Older instances cloned the source into $APP_DIR and built on the box. Keep that
# checkout (for rollback) and the image it built, tagged payroll-mail-service:pre-ecr.
if [ -d "$APP_DIR/.git" ]; then
  LEGACY_DIR="/opt/payroll-mail-legacy-src-$(date -u +%Y%m%d%H%M%S)"
  echo "Legacy git checkout found — moving it to $LEGACY_DIR"
  OLD_IMAGE=$(docker inspect --format '{{.Image}}' payroll-mail-service 2>/dev/null || true)
  if [ -n "$OLD_IMAGE" ]; then
    docker tag "$OLD_IMAGE" payroll-mail-service:pre-ecr
    echo "Tagged running image as payroll-mail-service:pre-ecr"
  fi
  mv "$APP_DIR" "$LEGACY_DIR"
fi
mkdir -p "$APP_DIR"
cd "$APP_DIR"

# ── Write .env from secret values ─────────────────────────────────────────
umask 077
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
umask 022

# ── Compose file (image from ECR; the tag is pinned by docker-compose.override.yml) ──
# The data volume is external (see DATA_VOLUME above) so it's reused whatever the project name.
cat > docker-compose.yml <<'EOF'
name: payroll-mail

services:
  mail-service:
    image: ${ecr_repo_url}:latest
    container_name: payroll-mail-service
    restart: unless-stopped
    # The worker finishes its in-flight batch on SIGTERM (up to 30 s).
    stop_grace_period: 40s
    # Loopback only (payroll-update health check); browsers come in through nginx.
    ports:
      - "127.0.0.1:3000:3000"
    volumes:
      - mail-data:/data
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
    environment:
      - SMTP_HOST=$${SMTP_HOST:-smtp.gmail.com}
      - SMTP_PORT=$${SMTP_PORT:-465}
      - SMTP_USER=$${SMTP_USER:-}
      - SMTP_PASS=$${SMTP_PASS:-}
      - FROM_EMAIL=$${FROM_EMAIL:-}
      - FROM_NAME=$${FROM_NAME:-}
      - DAILY_LIMIT=$${DAILY_LIMIT:-1800}
      - APP_PASSWORD=$${APP_PASSWORD:-}
      - ANTHROPIC_API_KEY=$${ANTHROPIC_API_KEY:-}
      # nginx is the only proxy in front of the app: trust exactly one hop.
      - TRUST_PROXY=1
      - SMTP_HOST_ALLOWLIST=${smtp_host_allowlist}
      - PAYSLIP_RETENTION_DAYS=${payslip_retention_days}
      - PAYSLIP_DELETE_AFTER_SEND=${payslip_delete_after_send}

  nginx:
    image: ${nginx_image}
    container_name: payroll-mail-nginx
    # Not unless-stopped: at boot payroll-mail-boot.service renews the certificate
    # first and then starts nginx. on-failure still restarts it after a crash.
    restart: on-failure
    depends_on:
      - mail-service
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /opt/payroll-mail/nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - /opt/payroll-mail/tls:/etc/nginx/tls:ro
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
EOF
printf '\nvolumes:\n  mail-data:\n    external: true\n    name: %s\n' "$DATA_VOLUME" >> docker-compose.yml

# ── nginx: TLS termination in front of the app ─────────────────────────────
cat > nginx.conf <<'EOF'
# Re-resolve the app container (its IP changes when payroll-update recreates it).
resolver 127.0.0.11 valid=10s ipv6=off;
server_tokens off;

server {
    listen 80 default_server;
    server_name _;
    return 301 https://${domain_name}$request_uri;
}

server {
    listen 443 ssl default_server;
    http2 on;
    server_name ${domain_name};

    ssl_certificate     /etc/nginx/tls/fullchain.pem;
    ssl_certificate_key /etc/nginx/tls/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:TLS:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;

    # The app adds its own HSTS when it sees X-Forwarded-Proto https; send it once, here.
    proxy_hide_header Strict-Transport-Security;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # /api/payslips/prepare takes an Excel + a ZIP of up to 100 MB each and runs
    # synchronously for up to 120 s.
    client_max_body_size 210m;
    proxy_read_timeout 180s;
    proxy_send_timeout 180s;

    location / {
        set $app http://mail-service:3000;
        proxy_pass $app;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        # One trusted hop (TRUST_PROXY=1): overwrite, never append, client-sent values.
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
EOF

# ── payroll-cert: Let's Encrypt certificate via DNS-01 (Route53, instance role) ──
# Usage: payroll-cert [--start]
# Issues the certificate if missing, otherwise renews it when < 30 days are left,
# copies it to /opt/payroll-mail/tls for nginx and reloads nginx if it changed.
# If issuance/renewal fails it keeps (and loudly warns about) the existing cert, or
# falls back to a short-lived self-signed one so nginx can still start.
# --start: also bring the stack up (the boot path, payroll-mail-boot.service).
cat > /usr/local/bin/payroll-cert <<'EOF'
#!/bin/bash
set -uo pipefail
DOMAIN="${domain_name}"
ACME_EMAIL="${acme_email}"
CERTBOT_IMAGE="${certbot_image}"
APP_DIR="/opt/payroll-mail"
TLS_DIR="$APP_DIR/tls"
LIVE="/etc/letsencrypt/live/$DOMAIN"

log()  { echo "payroll-cert: $*"; logger -t payroll-cert -- "$*"; }
loud() { echo "payroll-cert: ERROR: $*" >&2; logger -p user.err -t payroll-cert -- "ERROR: $*"; }

certbot() {
  # Host network: the container reaches IMDS for the instance-role credentials.
  docker run --rm --network host \
    -v /etc/letsencrypt:/etc/letsencrypt \
    -v /var/lib/letsencrypt:/var/lib/letsencrypt \
    -v /var/log/letsencrypt:/var/log/letsencrypt \
    "$CERTBOT_IMAGE" "$@"
}

mkdir -p /etc/letsencrypt /var/lib/letsencrypt /var/log/letsencrypt "$TLS_DIR"
chmod 700 "$TLS_DIR"
status=0

if [ -f "$LIVE/fullchain.pem" ]; then
  # Renews only when fewer than 30 days are left.
  certbot renew --non-interactive --no-random-sleep-on-renew || { status=1; loud "certbot renew failed"; }
else
  if [ -n "$ACME_EMAIL" ]; then ACCOUNT=(--email "$ACME_EMAIL" --no-eff-email); else ACCOUNT=(--register-unsafely-without-email); fi
  certbot certonly --dns-route53 -d "$DOMAIN" --non-interactive --agree-tos "$${ACCOUNT[@]}" \
    || { status=1; loud "certbot could not issue a certificate for $DOMAIN"; }
fi

changed=0
if [ -f "$LIVE/fullchain.pem" ]; then
  if ! cmp -s "$LIVE/fullchain.pem" "$TLS_DIR/fullchain.pem"; then
    install -m 644 "$LIVE/fullchain.pem" "$TLS_DIR/fullchain.pem"
    install -m 600 "$LIVE/privkey.pem" "$TLS_DIR/privkey.pem"
    changed=1
    log "installed certificate, $(openssl x509 -in "$TLS_DIR/fullchain.pem" -noout -enddate)"
  fi
elif [ ! -f "$TLS_DIR/fullchain.pem" ]; then
  loud "no Let's Encrypt certificate: serving a SELF-SIGNED one until issuance succeeds"
  openssl req -x509 -nodes -newkey rsa:2048 -days 30 -subj "/CN=$DOMAIN" \
    -keyout "$TLS_DIR/privkey.pem" -out "$TLS_DIR/fullchain.pem" 2>/dev/null
  chmod 600 "$TLS_DIR/privkey.pem"
  changed=1
fi

if ! openssl x509 -in "$TLS_DIR/fullchain.pem" -noout -checkend 0 >/dev/null; then
  loud "the certificate nginx serves has EXPIRED; browsers will refuse it"
elif ! openssl x509 -in "$TLS_DIR/fullchain.pem" -noout -checkend $((14 * 86400)) >/dev/null; then
  loud "the certificate nginx serves expires within 14 days"
fi

if [ "$${1:-}" = "--start" ]; then
  cd "$APP_DIR" && /usr/local/bin/docker-compose up -d || { status=1; loud "docker-compose up failed"; }
fi
if [ "$changed" = 1 ] && [ "$(docker inspect -f '{{.State.Running}}' payroll-mail-nginx 2>/dev/null)" = "true" ]; then
  docker exec payroll-mail-nginx nginx -s reload && log "nginx reloaded"
fi
exit "$status"
EOF
chmod 755 /usr/local/bin/payroll-cert

# Boot: renew first (the instance is stopped most of the year), then start nginx.
cat > /etc/systemd/system/payroll-mail-boot.service <<'EOF'
[Unit]
Description=Payroll Mail Service: renew TLS certificate, then start the stack
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/bin/payroll-cert --start
TimeoutStartSec=900

[Install]
WantedBy=multi-user.target
EOF

# Twice daily while running.
cat > /etc/systemd/system/payroll-cert-renew.service <<'EOF'
[Unit]
Description=Payroll Mail Service: renew TLS certificate
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/payroll-cert
EOF
cat > /etc/systemd/system/payroll-cert-renew.timer <<'EOF'
[Unit]
Description=Payroll Mail Service: renew TLS certificate twice daily

[Timer]
OnCalendar=*-*-* 00,12:00:00
RandomizedDelaySec=1h

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable payroll-mail-boot.service
systemctl enable --now payroll-cert-renew.timer

# ── payroll-update: pull an image tag from ECR and (re)start the container ──
# Usage: payroll-update [<tag>|<full image ref>]   (default: latest)
# Rolls back to the previous image automatically if the health check fails.
cat > /usr/local/bin/payroll-update <<'EOF'
#!/bin/bash
set -euo pipefail
REGISTRY="${ecr_registry}"
REPO_URL="${ecr_repo_url}"
REGION="${aws_region}"
APP_DIR="/opt/payroll-mail"
source /etc/payroll-mail.conf
REF="$${1:-latest}"
case "$REF" in
  *:*|*/*) IMAGE="$REF" ;;
  *)       IMAGE="$REPO_URL:$REF" ;;
esac

cd "$APP_DIR"
if [[ "$IMAGE" == "$REPO_URL"* ]]; then
  aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY"
  docker pull "$IMAGE"
fi

PREVIOUS=$(docker inspect --format '{{.Config.Image}}' payroll-mail-service 2>/dev/null || true)

# The image runs as the unprivileged node user (uid 1000); volumes created by the
# old root image need a one-off chown. Cheap and idempotent.
docker run --rm --user root --entrypoint chown -v "$DATA_VOLUME:/data" "$IMAGE" -R 1000:1000 /data

# A container with this name from another compose project (the old git deploy) would
# block `up`; its data lives on in $DATA_VOLUME.
PROJECT=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' payroll-mail-service 2>/dev/null || true)
if [ -n "$PROJECT" ] && [ "$PROJECT" != "payroll-mail" ]; then
  docker rm -f payroll-mail-service
fi

write_override() {
  printf 'services:\n  mail-service:\n    image: %s\n' "$1" > docker-compose.override.yml
}

write_override "$IMAGE"
/usr/local/bin/docker-compose up -d

for i in $(seq 1 30); do
  if curl -fs -o /dev/null http://127.0.0.1:3000/api/config; then
    echo "payroll-update: $IMAGE is healthy"
    # Not fatal (the app is fine); certificate problems are payroll-cert's to report.
    if curl -fsk -o /dev/null --resolve "${domain_name}:443:127.0.0.1" "https://${domain_name}/api/config"; then
      echo "payroll-update: nginx is serving https://${domain_name}"
    else
      echo "payroll-update: WARNING: nginx is not serving HTTPS; see 'docker logs payroll-mail-nginx'" >&2
    fi
    exit 0
  fi
  sleep 2
done

echo "payroll-update: $IMAGE failed its health check" >&2
docker logs --tail 50 payroll-mail-service >&2 || true
if [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$IMAGE" ]; then
  echo "payroll-update: rolling back to $PREVIOUS" >&2
  write_override "$PREVIOUS"
  /usr/local/bin/docker-compose up -d
fi
exit 1
EOF
chmod 755 /usr/local/bin/payroll-update

# ── Start ──────────────────────────────────────────────────────────────────
# Certificate first (issue or renew; never fatal here), then the app and nginx.
/usr/local/bin/payroll-cert || echo "WARNING: payroll-cert reported a problem (see above)" >&2
/usr/local/bin/payroll-update "${image_tag}"
# Pick up nginx.conf changes on a re-run (compose only recreates on compose changes).
docker exec payroll-mail-nginx nginx -s reload 2>/dev/null || true

echo "=== Bootstrap complete: https://${domain_name} (nginx on the instance) ==="
