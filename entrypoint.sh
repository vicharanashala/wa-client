#!/bin/sh

# Verify npx is available
if ! command -v npx > /dev/null 2>&1; then
  echo "❌ npx not found, starting without secrets..."
  exec node dist/main
fi

if [ -n "$INFISICAL_CLIENT_ID" ] && [ -n "$INFISICAL_CLIENT_SECRET" ]; then
  echo "🔐 Authenticating with Infisical Machine Identity..."
  
  # Fetch short-lived token using Machine Identity credentials
  export INFISICAL_TOKEN=$(npx --yes infisical@latest login \
    --method=universal-auth \
    --client-id="$INFISICAL_CLIENT_ID" \
    --client-secret="$INFISICAL_CLIENT_SECRET" \
    --silent \
    --plain)

  if [ -z "$INFISICAL_TOKEN" ]; then
    echo "❌ Failed to authenticate with Infisical, starting without secrets..."
    exec node dist/main
  fi

  echo "🔐 Fetching secrets from Infisical..."
  echo "   Environment: ${INFISICAL_ENVIRONMENT:-prod}"
  echo "   Path: ${INFISICAL_SECRET_PATH:-/}"
  echo "   Project ID: ${INFISICAL_PROJECT_ID}"

  exec npx --yes infisical@latest run \
    --projectId="${INFISICAL_PROJECT_ID}" \
    --env="${INFISICAL_ENVIRONMENT:-prod}" \
    --path="${INFISICAL_SECRET_PATH:-/}" \
    --token="${INFISICAL_TOKEN}" \
    -- node dist/main
else
  # Fallback for old INFISICAL_TOKEN method if still used
  if [ -n "$INFISICAL_TOKEN" ]; then
    echo "🔐 Using existing INFISICAL_TOKEN..."
    echo "   Environment: ${INFISICAL_ENVIRONMENT:-prod}"
    echo "   Path: ${INFISICAL_SECRET_PATH:-/}"
    echo "   Project ID: ${INFISICAL_PROJECT_ID}"

    exec npx --yes infisical@latest run \
      --projectId="${INFISICAL_PROJECT_ID}" \
      --env="${INFISICAL_ENVIRONMENT:-prod}" \
      --path="${INFISICAL_SECRET_PATH:-/}" \
      --token="${INFISICAL_TOKEN}" \
      -- node dist/main
  else
    echo "⚠️  No Infisical credentials set, starting without injected secrets..."
    exec node dist/main
  fi
fi