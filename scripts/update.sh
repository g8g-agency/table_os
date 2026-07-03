#!/bin/bash
# update.sh
set -e

echo "Updating Application..."

# Pull latest code
git pull origin main

# Run deployment
./scripts/deploy.sh
