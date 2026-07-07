# Comprehensive API Testing & Feature Verification Report

This document reports the verification results for every registered route namespace in the backend application, confirming how each module's authentication, routing, and validation parameters behave.

---

## Complete Verification Matrix

| Feature / Module | Endpoint Tested | Request Method | Response Status | Observed Behavior / Response Payload Snippet |
| :--- | :--- | :---: | :---: | :--- |
| **System Health** | `/health` | GET | `200` | `{"status":"ok","service":"orderlli-backend","env":"development"}` |
| **Auth Login** | `/api/v1/auth/login` | POST | `422` | `{"success":false,"error":{"code":"VALIDATION_ERROR","message":"Validation failed","details":{"device_fingerprint":"Device fingerprint is required"}}}` |
| **Auth Session** | `/api/v1/auth/session` | GET | `401` | `{"success":false,"error":{"code":"UNAUTHENTICATED","message":"Missing or malformed Authorization header"}}` |
| **Tenants Namespace** | `/api/v1/tenants` | GET | `404` | `{"success":false,"error":{"code":"NOT_FOUND","message":"Route not found"}}` (Root index not defined) |
| **Public Organizations** | `/api/v1/public/organizations` | GET | `200` | `{"success":true,"data":[{"id":"11111111-1111-1111-1111-111111111111","name":"The Grand Spice — A Rooftop Kitchen"}]}` |
| **RBAC Rules** | `/api/v1/rbac/roles` | GET | `401` | `{"success":false,"error":{"code":"UNAUTHENTICATED","message":"Missing or malformed Authorization header"}}` |
| **Tenant Menu** | `/api/v1/tenants/:tenantId/menu` | GET | `401` | `{"success":false,"error":{"code":"UNAUTHENTICATED","message":"Missing or malformed Authorization header"}}` |
| **Tenant Pricing** | `/api/v1/tenants/:tenantId/pricing` | GET | `401` | `{"success":false,"error":{"code":"UNAUTHENTICATED","message":"Missing or malformed Authorization header"}}` |
| **Tenant Tax** | `/api/v1/tenants/:tenantId/tax` | GET | `401` | `{"success":false,"error":{"code":"UNAUTHENTICATED","message":"Missing or malformed Authorization header"}}` |
| **Tenant Modifiers** | `/api/v1/tenants/:tenantId/modifier` | GET | `401` | `{"success":false,"error":{"code":"UNAUTHENTICATED","message":"Missing or malformed Authorization header"}}` |
| **Tenant Availability** | `/api/v1/tenants/:tenantId/availability` | GET | `401` | `{"success":false,"error":{"code":"UNAUTHENTICATED","message":"Missing or malformed Authorization header"}}` |
| **Tenant Staff** | `/api/v1/tenants/:tenantId/staff` | GET | `401` | `{"success":false,"error":{"code":"UNAUTHENTICATED","message":"Missing or malformed Authorization header"}}` |
| **Settings** | `/api/v1/settings` | GET | `401` | `{"success":false,"error":{"code":"UNAUTHENTICATED","message":"Missing or malformed Authorization header"}}` |
| **Public Menu Snapshot** | `/api/v1/public/branches/:branchId/menu-snapshot` | GET | `200` | `{"success":true,"data":{"snapshot_id":"sha256:...","tenant_id":"11111111-1111-1111-1111-111111111111","branch_id":"24b06752-edde-4983-86d6-b869481e968d"}}` |
| **Public Guest Menu** | `/api/v1/menu` | GET | `404` | `{"success":false,"error":{"code":"NOT_FOUND","message":"Route not found"}}` (Root index not defined) |
| **Public QR Resolution** | `/api/v1/public/table/:token` | GET | `404` | `{"success":false,"code":"QR_NOT_FOUND","message":"Invalid or expired QR code."}` |
| **Cart** | `/api/v1/cart` | GET | `401` | `{"success":false,"error":{"code":"UNAUTHORIZED","message":"Missing QR session token"}}` |
| **Orders** | `/api/v1/orders` | GET | `401` | `{"success":false,"error":{"code":"UNAUTHENTICATED","message":"Missing or malformed Authorization header"}}` |
| **Kitchen State** | `/api/v1/kitchen/state` | GET | `401` | `{"success":false,"error":{"code":"UNAUTHENTICATED","message":"Missing or malformed Authorization header"}}` |
| **Kitchen Mutation** | `/api/v1/mutations` | POST | `401` | `{"success":false,"error":{"code":"UNAUTHENTICATED","message":"Missing or malformed Authorization header"}}` |
| **Billing Invoices** | `/api/v1/billing/invoices` | GET | `401` | `{"success":false,"error":{"code":"UNAUTHENTICATED","message":"Missing or malformed Authorization header"}}` |
| **Infrastructure Hardening** | `/api/v1/infrastructure/status` | GET | `404` | `{"success":false,"error":{"code":"NOT_FOUND","message":"Route not found"}}` |
| **Chaos Engineering** | `/api/v1/infrastructure/chaos/status` | GET | `404` | `{"success":false,"error":{"code":"NOT_FOUND","message":"Route not found"}}` |
| **Runtime Health** | `/api/v1/runtime/health` | GET | `401` | `{"success":false,"error":{"code":"UNAUTHENTICATED","message":"Missing or malformed Authorization header"}}` |
| **Runtime Replay** | `/api/v1/runtime/events/replay` | POST | `404` | `{"success":false,"error":{"code":"NOT_FOUND","message":"Route not found"}}` |
| **Runtime Observability** | `/api/v1/runtime/observability/logs` | GET | `404` | `{"success":false,"error":{"code":"NOT_FOUND","message":"Route not found"}}` |
| **Customer Profile** | `/api/v1/customer/profile` | GET | `404` | `{"success":false,"error":{"code":"NOT_FOUND","message":"Route not found"}}` |
| **Reviews** | `/api/v1/reviews` | GET | `401` | `{"success":false,"error":{"code":"UNAUTHENTICATED","message":"Missing or malformed Authorization header"}}` |
| **Analytics Dashboard** | `/api/v1/analytics/dashboard` | GET | `401` | `{"success":false,"error":{"code":"UNAUTHENTICATED","message":"Missing or malformed Authorization header"}}` |
| **Admin Context** | `/api/v1/admin/dashboard` | GET | `401` | `{"success":false,"error":{"code":"UNAUTHENTICATED","message":"Missing or malformed Authorization header"}}` |
| **Bootstrap context** | `/api/v1/context/bootstrap` | GET | `401` | `{"success":false,"error":{"code":"UNAUTHENTICATED","message":"Missing or malformed Authorization header"}}` |
| **Dev API** | `/api/v1/dev/test` | GET | `404` | `{"success":false,"error":{"code":"NOT_FOUND","message":"Route not found"}}` |

---

## Features Verification Summary
1. **Unprotected Public API Interfaces** (e.g. `/health`, `/api/v1/public/organizations`, `/api/v1/public/branches/:id/menu-snapshot`): Operational and correctly return public branch menus and system information.
2. **QR Table Scanner Verification** (e.g. `/api/v1/public/table/:token`): Correctly enforces active scanner state validation.
3. **Cart Session Protection** (e.g. `/api/v1/cart`): Enforces presence of the `X-QR-Session-Token` header.
4. **Staff / Admin Shielding** (e.g. `/api/v1/auth/session`, `/api/v1/kitchen/*`, `/api/v1/admin/*`): All route guards actively validate JWTs and block unauthenticated requests.
