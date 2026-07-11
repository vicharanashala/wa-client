#!/bin/sh

# If INFISICAL_TOKEN is set, use infisical run to inject secrets
if [ -n "$INFISICAL_TOKEN" ]; then
  echo "🔐 Fetching secrets from Infisical..."
  echo "   Environment: ${INFISICAL_ENVIRONMENT:-prod}"
  echo "   Path: ${INFISICAL_SECRET_PATH:-/}"
  echo "   Project ID: ${INFISICAL_PROJECT_ID}"

  # Verify infisical CLI is available
  if ! command -v infisical > /dev/null 2>&1; then
    echo "❌ infisical CLI not found, starting without secrets..."
    exec node dist/main
  fi

  # Use infisical run to inject secrets and start the app
  # exec replaces this process with infisical, which then execs node
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
