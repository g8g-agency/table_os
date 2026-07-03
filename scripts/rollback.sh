#!/bin/bash
# rollback.sh
set -e

echo "Initiating Rollback..."

# Bring down current broken deployment
docker compose down

echo "Please restore the previous version from backup or revert git commit and redeploy."
echo "e.g., git checkout HEAD^1 && ./scripts/deploy.sh"
