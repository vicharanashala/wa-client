#!/bin/sh
set -e

# If INFISICAL_TOKEN is set, use infisical run to inject secrets
if [ -n "$INFISICAL_TOKEN" ]; then
  echo "🔐 Fetching secrets from Infisical..."
  exec infisical run \
    --projectId="${INFISICAL_PROJECT_ID}" \
    --env="${INFISICAL_ENVIRONMENT:-prod}" \
    --path="${INFISICAL_SECRET_PATH:-/}" \
    --token="${INFISICAL_TOKEN}" \
    -- node dist/main
else
  echo "⚠️  No INFISICAL_TOKEN set, starting without Infisical secrets..."
  exec node dist/main
fi
