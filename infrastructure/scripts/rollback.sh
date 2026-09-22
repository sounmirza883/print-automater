#!/usr/bin/env bash
# 14.4: rewritten from ECS to Docker Compose. ECS had no single
# "rollback" API call -- it found each service's currently-running task
# definition revision and re-pointed the service at revision-1. There
# is no task-definition-revision concept anymore (12.7's ECS setup was
# deleted with Terraform in 14.2): production is
# infrastructure/docker/docker-compose.prod.yml on a single Docker
# host, and "rolling back" is just re-pulling the previous ghcr.io
# image tags (a git commit SHA) and re-applying the compose file with
# those tags -- api/worker/customer-web only, matching
# .github/workflows/deploy-staging.yml's own deploy step.
#
# Requires SSH access to the same host the deploy pipeline deploys to,
# and that host already having infrastructure/docker/.env.prod and
# docker-compose.prod.yml checked out/synced at COMPOSE_DIR (this
# script never provisions the host itself, same as the deploy
# pipeline).
set -euo pipefail

: "${SSH_HOST:?Set SSH_HOST}"
: "${SSH_USER:?Set SSH_USER}"
: "${COMPOSE_DIR:?Set COMPOSE_DIR (remote path holding docker-compose.prod.yml)}"
: "${ROLLBACK_TAG:?Set ROLLBACK_TAG to the previous known-good image tag (a git commit SHA)}"

REGISTRY_NAMESPACE="${REGISTRY_NAMESPACE:-ghcr.io/sounmirza883/print-automater}"

echo "Rolling back api/worker/customer-web to ${REGISTRY_NAMESPACE}/*:${ROLLBACK_TAG} on ${SSH_HOST}..."

# shellcheck disable=SC2087
ssh "${SSH_USER}@${SSH_HOST}" bash -s <<REMOTE
set -euo pipefail
cd "${COMPOSE_DIR}"
export API_IMAGE="${REGISTRY_NAMESPACE}/api:${ROLLBACK_TAG}"
export WORKER_IMAGE="${REGISTRY_NAMESPACE}/worker:${ROLLBACK_TAG}"
export CUSTOMER_WEB_IMAGE="${REGISTRY_NAMESPACE}/customer-web:${ROLLBACK_TAG}"
docker compose --env-file infrastructure/docker/.env.prod \
  -f infrastructure/docker/docker-compose.prod.yml pull api worker customer-web
docker compose --env-file infrastructure/docker/.env.prod \
  -f infrastructure/docker/docker-compose.prod.yml up -d api worker customer-web
REMOTE

echo "Waiting for /v1/health/ready to return 200 on the rolled-back version..."
: "${ROLLBACK_HEALTH_URL:=}"
if [ -n "$ROLLBACK_HEALTH_URL" ]; then
  for _ in $(seq 1 30); do
    if curl -sf "${ROLLBACK_HEALTH_URL%/}/v1/health/ready" > /dev/null; then
      echo "Rollback complete -- /v1/health/ready is green."
      exit 0
    fi
    sleep 5
  done
  echo "Rollback deployed but /v1/health/ready never returned 200 within 150s." >&2
  exit 1
fi

echo "Rollback deployed. Set ROLLBACK_HEALTH_URL to also gate this script on /v1/health/ready."
echo ""
echo "Note: this reverts running containers only -- a migration applied"
echo "by the deploy this rolled back is NOT reverted (Prisma migrations"
echo "in this project are additive/forward-only, per the deploy"
echo "pipeline's own migration-strategy comment; a rolled-back old"
echo "container reading a newer-but-compatible schema is the expected,"
echo "safe state, not a bug)."
