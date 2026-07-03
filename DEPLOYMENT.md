# Orderlli Production Deployment Guide

This repository contains the Backend API, Customer QR Menu, and Kitchen Display System (KDS). 
It is configured for production deployment using Docker Compose and Nginx.

## Server Requirements
- **OS**: Ubuntu 22.04 LTS (or equivalent Linux distribution)
- **Dependencies**: Docker, Docker Compose Plugin, Git
- **Resources**: 2GB+ RAM, 2+ vCPUs recommended for demo

## Architecture
- **Backend Container**: Node.js API running on port 3001.
- **Frontend Container**: Nginx serving the Vite SPA for both Customer Menu and KDS on port 80.
- **Proxy Container**: Nginx reverse proxy that routes traffic to frontend/backend based on the domain name.
- **Monitoring**: Uptime Kuma running on port 3002.

## Deployment Steps

1. **Clone the Repository**
   ```bash
   git clone <repo-url> orderlli
   cd orderlli/tableos
   ```

2. **Environment Variables**
   Copy the example environment files and fill them out.
   ```bash
   cp .env.production.example .env.production
   cp backend/.env.production.example backend/.env.production
   ```
   **Important**: In `backend/.env.production`, ensure you generate completely random secrets (minimum 16 characters) for:
   - `QR_SIGNING_SECRET`
   - `QR_SESSION_SECRET`
   - `DEVICE_TOKEN_SECRET`
   - `RUNTIME_JWT_SECRET`

3. **SSL Certificates**
   By default, the Nginx reverse proxy in `docker-compose.yml` listens on port 80 and expects SSL to be managed externally (e.g. Cloudflare Origin Certs or an external load balancer). 
   To enable SSL directly in Nginx:
   - Place your certs in `/etc/letsencrypt` on the host machine.
   - Uncomment the SSL sections in `nginx/reverse-proxy.conf`.
   - Uncomment the volume mount for `/etc/letsencrypt` in `docker-compose.yml`.

4. **Deploy**
   Run the deployment script:
   ```bash
   ./scripts/deploy.sh
   ```
   This will build the images, start the containers, and poll the health endpoints to ensure the services booted correctly. If the health checks fail, it will automatically initiate a rollback.

## Operations

### Updating the Application
To pull the latest code and redeploy:
```bash
./scripts/update.sh
```

### Backups
To backup the current environment variables and configurations:
```bash
./scripts/backup.sh
```

### Rollback
If a deployment fails, run:
```bash
./scripts/rollback.sh
```
And manually revert your git tree or restore the environment files.

## Troubleshooting

Check the logs (which are automatically rotated and capped at 10MB per file):
```bash
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f proxy
```

---

## Deployment Verification Checklist
Before considering the deployment live, verify the following:

- [ ] **Backend Health**: `curl https://api.demo.domain.com/health` returns `status: ok`
- [ ] **Frontend Availability**: Browsing `https://menu.demo.domain.com` and `https://kds.demo.domain.com` successfully loads the UI.
- [ ] **API Connectivity**: Network tab in browser confirms API requests go to `api.demo.domain.com` and not `localhost`.
- [ ] **Supabase Connectivity**: Backend successfully signs in and verifies tokens.
- [ ] **Realtime Functionality**: WebSockets connect without errors at `/api/v1/realtime` (verify Nginx is successfully proxying `Upgrade` headers).
- [ ] **QR Ordering Flow**: Customer can scan a mock QR link, check out, and it successfully reaches the server.
- [ ] **KDS Updates**: Test orders appear correctly on the KDS board without manual refresh.
- [ ] **HTTPS / CORS**: No mixed-content errors in the browser console. CORS headers are present.
- [ ] **Secrets Audit**: Verify that no `development` or `localhost` URLs exist in `.env.production`.
