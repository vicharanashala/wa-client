#!/bin/bash
set -e

echo "Authenticating with Infisical..."
export INFISICAL_TOKEN=$(
  npx @infisical/cli@0.43.40 login \
    --method=universal-auth \
    --client-id="$INFISICAL_CLIENT_ID" \
    --client-secret="$INFISICAL_CLIENT_SECRET" \
    --silent \
    --plain
)

if [ -z "$INFISICAL_TOKEN" ]; then
  echo "✗ Infisical authentication failed"
  exit 1
fi

echo "✓ Infisical authenticated successfully"

# Get secrets from Infisical and export them
echo "Loading secrets from Infisical..."
eval "$(npx @infisical/cli@0.43.40 run --projectId="$INFISICAL_PROJECT_ID" --env="$INFISICAL_ENVIRONMENT" --path="$INFISICAL_SECRET_PATH" --silent --raw)"

echo "✓ Secrets loaded from Infisical"

# Start the application
echo "Starting application..."
exec node dist/main