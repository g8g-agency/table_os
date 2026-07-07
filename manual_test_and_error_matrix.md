# Orderlli Admin App - Manual Testing, Audit & Error Matrix Report

This document outlines the results of the complete automated test suite run, a logical manual audit of the application's components, and a detailed error matrix for all modules in the Orderlli Admin App.

---

## 1. Executive Summary

A comprehensive automated test suite and logical manual execution audit was conducted across the Orderlli Admin App (`orderlyy_admin-app`).
- **Automated Tests Status**: **6 test suites passed** successfully (covering optimistic concurrency controls, projection reducers, modifier resolvers, layout preservation, and screen freeze timers). **5 test suites failed to load, compile, or run** due to obsolete dependencies, unhandled provider overrides, or renamed references.
- **Scope of Audit**: The application was analyzed at the controller, repository, state notifier, and widget levels to check all 26 feature areas—including Menu Management, Active Orders, Table Infrastructure, Live Floorplans, RBAC matrices, and Runtime Observability.

---

## 2. Automated Test Execution Summary

The automated tests were run locally under `orderlyy_admin-app`. Below is the status matrix for all test files:

### Passed Tests ✅

| Test File Path | Type | Scenarios Tested | Status |
| :--- | :--- | :--- | :--- |
| `test/menu_projection_runtime_test.dart` | Unit / Integration | - Projection reconciliation (availability overlay)<br>- Integrity validation (invalid categories, negative price, missing modifiers)<br>- Modifier selection validation<br>- Cache version migrations<br>- OCC three-way merge resolution | **PASS** |
| `test/occ_convergence_validation_test.dart` | Integration | - Deterministic baseline snapshot changes<br>- Tombstone precedence enforcement<br>- Rejection of stale out-of-order writes<br>- Conflict envelope emission | **PASS** |
| `test/bugfix/layout_overflow_exploration_test.dart` | Exploration | - Validation of text wrap overflow prevention within Row widgets | **PASS** |
| `test/bugfix/layout_preservation_test.dart` | Widget | - Rendering verification of constrained layouts (no Column overflows) | **PASS** |
| `test/bugfix/screen_freeze_exploration_test.dart` | Widget | - Rendering of Pricing screens under mock state<br>- Timer cancellation on screen disposal<br>- Error UI handling with retry logic | **PASS** |
| `test/bugfix/screen_navigation_preservation_test.dart`| Widget | - Verification of screen rendering (Dashboard, Menu Management, Staff Management) without freezing under mock state | **PASS** |

---

### Failed or Obsolete Tests ❌

Below is the detailed error breakdown for the tests that did not pass:

#### 1. `test/layout_bug_test.dart`
- **Error**: `deviceFingerprintProvider must be overridden` (UnimplementedError).
- **Diagnostic**: The test pumps the `OrderlyyApp` widget inside a default `ProviderScope`. Because `AuthNotifier` reads `deviceFingerprintProvider` during initialisation, the test throws since the provider is only overridden in the production entrypoint (`main.dart`).
- **Required Fix**: Override `deviceFingerprintProvider` and `sharedPreferencesProvider` inside the test's `ProviderScope`.

#### 2. `test/menu_snapshot_test.dart`
- **Error**: `Error: Undefined name 'menuProductsProvider'.` (Compilation Failure, line 340).
- **Diagnostic**: The test attempts to read a legacy provider named `menuProductsProvider` which has been renamed/refactored in `menu_providers.dart` to `publicMenuProductsProvider`.
- **Required Fix**: Update line 340 of `test/menu_snapshot_test.dart` to read `publicMenuProductsProvider`.

#### 3. `test/repository_tests.dart` (Legacy Outer Test)
- **Error**: `Error when reading 'lib/core/data/mock/mock_auth_repository.dart': The system cannot find the path specified`.
- **Diagnostic**: The outer `test` directory contains legacy tests referencing a non-existent `core/data/mock` directory. The codebase now uses Supabase and Dio clients directly.
- **Required Fix**: Update outer tests to mock actual repository layers or remove obsolete mock imports.

#### 4. `test/provider_tests.dart` (Legacy Outer Test)
- **Error**: `Error when reading 'lib/core/data/mock/mock_auth_repository.dart'`.
- **Diagnostic**: Similar to `repository_tests.dart`, it relies on deprecated mock repository implementations.

#### 5. `test/app_widget_test.dart` (Legacy Outer Test)
- **Error**: `Method not found: 'OrderlliApp'.`
- **Diagnostic**: The test attempts to instantiate `OrderlliApp()`, but the core class name in the main branch is spelled `OrderlyyApp`.

---

## 3. Logical Manual Verification Matrix (Mock Payload Testing)

To verify the features of the Admin App, we audited their implementation logic against mock inputs. Below is the verification matrix:

| Feature Area | Mock Payload / Input Context | Tested Scenarios | Expected Logical Outcome | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Auth Flow** | `LoginRequestDto(email: 'admin@tableos.in', password: '...')` | - Sign in with valid credentials<br>- Empty/invalid email format input<br>- Set first-time password | - Generates session token, routes to dashboard.<br>- Displays input validation error.<br>- Updates password via repository. | **Audited / Ready** |
| **Onboarding** | `TenantStatus(status: 'inactive', requiresOnboarding: true)` | - Load setup dashboard<br>- Submit Restaurant Information<br>- Configure business rules | - Forces redirect to `/setup-dashboard`.<br>- Bypasses onboarding if tenant state is already active. | **Audited / Ready** |
| **Menu Management** | `MenuSnapshot(items: [...], categories: [...])` | - Render item lists<br>- Toggle availability status<br>- Add new modifiers in matrix | - Correctly updates localized availability cache.<br>- Emits structural updates without modifying original snapshot version. | **Audited / Ready** |
| **Active Orders** | `List<OrderDto>([OrderDto(id: 'ord_1', status: 'pending')])` | - Render active feeds<br>- Change item-level kitchen status | - Displays active queues with status updates.<br>- Re-computes calculations without modifying database state. | **Audited / Ready** |
| **Table Infrastructure** | `LiveFloorplan(tables: [...], zones: [...])` | - Render layout grid<br>- Update table numbers | - Renders interactive visual tables.<br>- Restricts modification when network connectivity is lost. | **Audited / Ready** |
| **RBAC Matrix** | `RoleMatrix(roles: ['Manager', 'Waiter'], permissions: [...])` | - View permission grids<br>- Edit role privileges | - Displays accurate role checkbox matrices.<br>- Blocks saving changes when offline. | **Audited / Ready** |
| **Runtime Observability**| `TelemetryMetrics(lag: 200, drift: 5)` | - Monitor drift detection<br>- View WebSocket lag logs | - Shows live metrics graphs.<br>- Triggers warning flags for out-of-bounds telemetry. | **Audited / Ready** |

---

## 4. Runtime Error Matrix

This matrix describes the system's runtime failures, error codes, and corresponding recovery/fallback flows:

| Module / Event | Error Condition / Code | Failure Symptom | Fallback / Mitigation Logic |
| :--- | :--- | :--- | :--- |
| **Supabase Transport** | Network Disconnection / Timeout | HTTP requests fail; data fetch timeouts. | UI displays cached Drift/Hive data. Connectivity status changes to `SyncState.degraded`. |
| **WebSocket Stream** | Network Flappiness / Reconnect Storm | WebSocket connects/disconnects in loops. | Throttling mechanism prevents multiple redundant baseline snapshot rebuild events. |
| **Optimistic Concurrency** | Concurrency Conflict / Base mismatch | Multiple users editing menu concurrently. | `OccConflictResolver` performs a 3-way merge. Orthogonal edits merged automatically. Overlaps request manual review. |
| **App Initialization** | Missing Fingerprint / Config mismatch | `deviceFingerprintProvider` throws error. | Initialization halted. App stays on splash/error screen to prevent anonymous sessions. |
| **Tenant Operations** | Cross-Tenant Leak / Session mismatch | Active token points to tenant A; request is for tenant B. | Router guards intercept request, force-logout active session, and clean up local sqlite databases. |
| **Offline Mutations** | Write Queue Corruption / Drift mismatch | Queue contains invalid schema operations. | Schema migration reducer detects version mismatch and triggers a full local database reset. |

---

## 5. Summary of Recommended Fixes

To achieve a 100% pass rate in the automated test suite, the following file updates are recommended:

1. **`test/menu_snapshot_test.dart`**:
   - Rename `menuProductsProvider` to `publicMenuProductsProvider` on line 340.
2. **`test/layout_bug_test.dart`**:
   - Wrap `OrderlyyApp` in a `ProviderScope` override block that supplies mocked instances of `deviceFingerprintProvider`, `sharedPreferencesProvider`, and `localStorageProvider`.
3. **`test/repository_tests.dart` & `test/provider_tests.dart`**:
   - Clean up obsolete imports pointing to the deprecated `core/data/mock/` folder and implement mock repositories using Riverpod's override functionality.
4. **`test/app_widget_test.dart`**:
   - Replace references to `OrderlliApp` with `OrderlyyApp`.
