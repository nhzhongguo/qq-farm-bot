# QQ Farm Commercial v2.4 Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a backward-compatible commercial-grade v2.4.0 upgrade for the local-first QQ Farm operations console.

**Architecture:** Preserve the current Node.js/Express, Vue 3/Pinia, and JSON single-node model. Add narrow services for version metadata, runtime diagnosis, persistent task history, audit records, and diagnostic exports; expose them through authenticated REST endpoints and use focused Vue views/components rather than another large page rewrite.

**Tech Stack:** Node.js CommonJS, Express, Node Test Runner, Vue 3, TypeScript, Pinia, Vite, UnoCSS, Playwright, GitHub Actions.

---

### Task 1: Release Contracts and CI

**Files:**
- Create: `version.json`
- Create: `.github/workflows/ci.yml`
- Create: `core/test/release-contract.test.js`
- Modify: `package.json`
- Modify: `core/package.json`
- Modify: `web/package.json`
- Modify: `README.md`

- [ ] Write contract tests that require a `2.4.0` version manifest, non-mutating lint scripts, and a CI workflow without publishing credentials.
- [ ] Run `node --test core/test/release-contract.test.js` and verify the missing manifest/scripts/workflow fail.
- [ ] Add manifest, `lint:check`, `lint:fix`, smoke command, and pinned CI workflow.
- [ ] Run `pnpm test`, `pnpm lint:check`, and `pnpm build:web`.

### Task 2: Runtime Doctor and Version Status

**Files:**
- Create: `core/src/services/runtime-doctor.js`
- Create: `core/test/runtime-doctor.test.js`
- Modify: `core/src/controllers/admin.js`
- Modify: `web/src/views/AdminPanel.vue`
- Modify: `web/src/api/index.ts`

- [ ] Write tests for data-directory writability, required packaged resources, version manifest parsing, and non-sensitive results.
- [ ] Run the isolated doctor tests and verify the missing service/API fails.
- [ ] Add the read-only service and admin-only `/api/admin/doctor` endpoint.
- [ ] Add an AdminPanel system status section with loading, empty/error, and retry state.
- [ ] Run core tests, web type/build, and an authenticated API smoke test.

### Task 3: Persistent Task Runs

**Files:**
- Create: `core/src/services/task-run-store.js`
- Create: `core/src/services/task-run-reporter.js`
- Create: `core/test/task-run-store.test.js`
- Create: `core/test/worker-manager-task-run.test.js`
- Modify: `core/src/core/worker.js`
- Modify: `core/src/runtime/worker-manager.js`
- Modify: `core/src/controllers/admin.js`
- Modify: `web/src/views/Scheduler.vue`

- [ ] Write tests for lifecycle transitions, retention, restart persistence, owner filtering, and malformed records.
- [ ] Run tests before implementation and verify they fail because the store/reporter are absent.
- [ ] Persist a bounded, atomically-written history; Worker only emits structured lifecycle events and manager is the single writer.
- [ ] Add an authenticated account-scoped read endpoint and a Scheduler history timeline.
- [ ] Run service, HTTP, E2E scheduler, core, and web build checks.

### Task 4: Audit and Diagnostic Operations

**Files:**
- Create: `core/src/services/audit-log.js`
- Create: `core/src/services/diagnostic-bundle.js`
- Create: `core/test/audit-log.test.js`
- Create: `core/test/diagnostic-bundle.test.js`
- Modify: `core/src/controllers/admin.js`
- Modify: `web/src/views/AdminPanel.vue`
- Modify: `web/src/views/Dashboard.vue`

- [ ] Write tests for nested redaction, retention, persistence, admin-only retrieval, and a diagnostic bundle that excludes credentials.
- [ ] Run tests in red state before adding services.
- [ ] Record high-risk admin changes through one narrow audit helper; do not log raw passwords, tokens, codes, API keys, or card secrets.
- [ ] Generate a bounded JSON diagnostic bundle from task runs, status snapshots, logs, and a sanitized config summary.
- [ ] Add AdminPanel audit search and Dashboard failure-diagnostic download actions with confirmation/error handling.
- [ ] Run core tests, browser/API smoke, web E2E, and build.

### Task 5: Console Experience and Configuration Productivity

**Files:**
- Create: `web/src/components/ui/LoadingState.vue`
- Create: `core/src/services/account-policy-transfer.js`
- Create: `core/test/config-transfer.test.js`
- Modify: `web/src/views/Settings.vue`
- Modify: `web/src/views/Dashboard.vue`
- Modify: `web/src/components/Sidebar.vue`
- Modify: `web/src/styles/tokens.css`
- Modify: `core/src/models/store.js`
- Modify: `core/src/controllers/admin.js`
- Modify: `web/e2e/*.spec.ts`

- [ ] Write backend tests for versioned policy export, redaction, unknown fields, confirmation, and owner boundaries.
- [ ] Verify red tests before implementation.
- [ ] Add a schema-versioned, sanitized policy transfer service with preview and explicit apply; no credential export.
- [ ] Add shared loading state, improved dashboard action priority, Settings import/export preview, and narrow mobile keyboard/empty/error states.
- [ ] Add desktop and mobile Playwright coverage for the critical workflows.
- [ ] Run core tests, lint check, web build, and full E2E suite.

### Task 6: Release Verification and Publication

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `version.json`

- [ ] Re-read all task requirements against the diff; remove unused code and avoid new dependencies.
- [ ] Run `pnpm test`, `pnpm lint:check`, `pnpm build:web`, `pnpm test:e2e`, and `pnpm audit --prod`.
- [ ] Run isolated local browser checks for desktop and mobile layouts, nonblank render, and API doctor/task history/audit views.
- [ ] Update changelog with Added, Changed, Fixed, and Security sections for `v2.4.0`.
- [ ] Inspect `git status`, stage only intended files, commit `upgrade: 完成项目2.4版本全面升级`, and push only the verified private `origin` remote.
