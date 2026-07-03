#!/bin/bash
# deploy.sh
set -e

echo "Starting Deployment..."

# Build docker images
echo "Building images..."
docker compose build

# Start containers
echo "Starting containers..."
docker compose up -d

echo "Waiting for services to become healthy..."
sleep 15

# Check backend health
BACKEND_STATUS=$(docker inspect --format='{{json .State.Health.Status}}' orderlli_backend)
if [ "$BACKEND_STATUS" != "\"healthy\"" ]; then
    echo "Backend is not healthy. Status: $BACKEND_STATUS"
    echo "Initiating rollback..."
    ./scripts/rollback.sh
    exit 1
fi

# Check frontend health
FRONTEND_STATUS=$(docker inspect --format='{{json .State.Health.Status}}' orderlli_frontend)
if [ "$FRONTEND_STATUS" != "\"healthy\"" ]; then
    echo "Frontend is not healthy. Status: $FRONTEND_STATUS"
    echo "Initiating rollback..."
    ./scripts/rollback.sh
    exit 1
fi

echo "Deployment Successful!"
