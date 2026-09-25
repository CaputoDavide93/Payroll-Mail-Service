#!/usr/bin/env bash
# Build the image, push it to ECR (:latest, :base, :<git sha>) and roll the
# instance to the new sha via SSM Run Command.
#
#   scripts/deploy.sh              build, push, roll
#   ROLL=0 scripts/deploy.sh       build and push only
#   scripts/deploy.sh --roll <tag> roll the instance to an existing tag (rollback)
#
# Don't run it during a payroll send: the container restart pauses the worker
# (in-flight batches finish first, pending recipients resume on start).
set -euo pipefail

REGION="${AWS_REGION:-eu-west-1}"
ACCOUNT="${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query Account --output text)}"
REPO="payroll-mail-service"
REGISTRY="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"
IMAGE="$REGISTRY/$REPO"

instance_id() {
  if [ -n "${INSTANCE_ID:-}" ]; then echo "$INSTANCE_ID"; return; fi
  aws ec2 describe-instances --region "$REGION" \
    --filters "Name=tag:Name,Values=payroll-mail-service" "Name=instance-state-name,Values=running" \
    --query 'Reservations[0].Instances[0].InstanceId' --output text
}

roll() {
  local tag="$1" id cmd_id status
  id=$(instance_id)
  if [ -z "$id" ] || [ "$id" = "None" ]; then
    echo "No running payroll-mail-service instance found" >&2; exit 1
  fi
  echo "Rolling $id to $IMAGE:$tag via SSM..."
  cmd_id=$(aws ssm send-command --region "$REGION" --instance-ids "$id" \
    --document-name AWS-RunShellScript \
    --comment "payroll-update $tag" \
    --parameters "commands=[\"/usr/local/bin/payroll-update $tag\"]" \
    --query Command.CommandId --output text)
  # Poll rather than `aws ssm wait` (which gives up after ~100 s; an image pull can take longer).
  for _ in $(seq 1 60); do
    sleep 5
    status=$(aws ssm get-command-invocation --region "$REGION" --command-id "$cmd_id" --instance-id "$id" \
      --query '[Status,StandardOutputContent,StandardErrorContent]' --output text 2>/dev/null || echo Pending)
    case "$status" in Pending*|InProgress*|Delayed*) continue ;; *) break ;; esac
  done
  echo "$status"
  case "$status" in Success*) ;; *) echo "Roll failed (payroll-update rolls back on a failed health check)" >&2; exit 1 ;; esac
}

if [ "${1:-}" = "--roll" ]; then
  roll "${2:?usage: scripts/deploy.sh --roll <tag>}"
  exit 0
fi

cd "$(dirname "$0")/.."
if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is dirty; commit first so the :<sha> tag matches the code." >&2
  exit 1
fi
SHA=$(git rev-parse --short=12 HEAD)

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY"

docker buildx build \
  --platform linux/amd64 \
  --pull \
  --provenance=false \
  --sbom=false \
  -t "$IMAGE:latest" \
  -t "$IMAGE:base" \
  -t "$IMAGE:$SHA" \
  --push \
  .

echo "Pushed $IMAGE:$SHA (+ latest, base)"

if [ "${ROLL:-1}" = "1" ]; then
  roll "$SHA"
fi
