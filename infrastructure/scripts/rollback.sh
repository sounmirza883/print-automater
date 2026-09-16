#!/usr/bin/env bash
# §12.8's own "rollback procedure." ECS has no single "rollback"
# API call -- this finds each service's currently-running task
# definition revision and re-points the service at revision-1, the
# same task definition (same image, same env) that was running
# immediately before the deploy this is rolling back. Requires the
# same AWS credentials/region the deploy pipeline itself uses.
set -euo pipefail

: "${AWS_REGION:?Set AWS_REGION}"
: "${PROJECT_NAME:?Set PROJECT_NAME}"
: "${ENVIRONMENT:?Set ENVIRONMENT}"

CLUSTER="${PROJECT_NAME}-${ENVIRONMENT}"
SERVICES=(api worker web)

for service in "${SERVICES[@]}"; do
  SERVICE_NAME="${PROJECT_NAME}-${ENVIRONMENT}-${service}"
  FAMILY="${PROJECT_NAME}-${ENVIRONMENT}-${service}"

  CURRENT_REVISION=$(aws ecs describe-services \
    --cluster "$CLUSTER" --services "$SERVICE_NAME" \
    --query 'services[0].taskDefinition' --output text \
    | grep -oE '[0-9]+$')

  PREVIOUS_REVISION=$((CURRENT_REVISION - 1))

  if [ "$PREVIOUS_REVISION" -lt 1 ]; then
    echo "$service: already at revision $CURRENT_REVISION, nothing to roll back to. Skipping."
    continue
  fi

  echo "$service: rolling back from revision $CURRENT_REVISION to $PREVIOUS_REVISION."
  aws ecs update-service \
    --cluster "$CLUSTER" \
    --service "$SERVICE_NAME" \
    --task-definition "${FAMILY}:${PREVIOUS_REVISION}"
done

echo "Waiting for all three services to stabilize on their rolled-back revisions..."
for service in "${SERVICES[@]}"; do
  aws ecs wait services-stable --cluster "$CLUSTER" --services "${PROJECT_NAME}-${ENVIRONMENT}-${service}"
done

echo "Rollback complete. Note: this reverts running containers only -- a"
echo "migration applied by the deploy this rolled back is NOT reverted"
echo "(Prisma migrations in this project are additive/forward-only, per"
echo "the deploy pipeline's own migration-strategy comment; a rolled-back"
echo "old container reading a newer-but-compatible schema is the expected,"
echo "safe state, not a bug)."
