# Sentry Integration Verification

This document verifies the integration and filtering logic of Sentry in the Orderlli backend. Sentry is configured to capture only unexpected runtime exceptions (5xx) while ignoring expected operational errors (4xx).

## Test Cases

| Scenario | Expected Behavior | Actual Behavior | Status |
| :--- | :--- | :--- | :--- |
| **500 Internal Error** | Caught by `errorMiddleware`. The exception reaches Sentry with full context (Tenant, Branch, User, Request ID). Client receives standard 500 JSON response. | Reaches Sentry. Full context verified. Client receives standard 500 JSON response. | ✅ Passed |
| **422 Validation** | Caught by `errorMiddleware` as a `ZodError`. Does **NOT** reach Sentry. Client receives 422 JSON response with field-level details. | Does NOT reach Sentry. | ✅ Passed |
| **401 Unauthorized** | Operational `AppError`. Does **NOT** reach Sentry. Client receives 401 JSON response. | Does NOT reach Sentry. | ✅ Passed |
| **403 Forbidden** | Operational `AppError`. Does **NOT** reach Sentry. Client receives 403 JSON response. | Does NOT reach Sentry. | ✅ Passed |
| **404 Route Not Found** | Caught by 404 handler and passed as `AppError`. Does **NOT** reach Sentry. Client receives 404 JSON response. | Does NOT reach Sentry. | ✅ Passed |

## Context Verification

For the successfully captured 500 errors, the following metadata was verified in the Sentry UI:
- [x] `tenant_id` and `branch_id`
- [x] `request_id`
- [x] `route` and HTTP `method`
- [x] `user_role` and `staff_id` (when authenticated)
- [x] `environment` and `release` (APP_VERSION)
