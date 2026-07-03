#!/bin/bash
# backup.sh
set -e

BACKUP_DIR="./backups/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

echo "Backing up configuration files..."
cp .env.production "$BACKUP_DIR/" 2>/dev/null || true
cp backend/.env.production "$BACKUP_DIR/" 2>/dev/null || true
cp docker-compose.yml "$BACKUP_DIR/"

echo "Backup complete: $BACKUP_DIR"
