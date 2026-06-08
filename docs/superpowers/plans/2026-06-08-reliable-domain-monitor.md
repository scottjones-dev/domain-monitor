# Reliable Domain Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a tested hourly GitHub Actions monitor that emails when `penruddockearms.co.uk` is confirmed available by Nominet RDAP.

**Architecture:** Keep the application in one focused ES module with exported configuration, lookup, notification, and orchestration functions. Inject network, email, delay, and logging dependencies so Node's built-in test runner can verify behavior without live services.

**Tech Stack:** Node.js 24, JavaScript ES modules, Node test runner, Resend, GitHub Actions

---

## File Structure

- `check-domain.js`: validated configuration, RDAP retry/classification, Resend delivery, and CLI entry point.
- `test/check-domain.test.js`: behavior tests using injected dependencies.
- `package.json`: module metadata, scripts, and Resend dependency.
- `package-lock.json`: reproducible dependency resolution.
- `.github/workflows/check-domain.yml`: hourly installation, test, and monitor workflow.
- `README.md`: GitHub secret/variable and Resend sender setup.

### Task 1: Package And Configuration

**Files:**
- Create: `package.json`
- Create: `test/check-domain.test.js`
- Modify: `check-domain.js`

- [x] **Step 1: Add a failing configuration test**

Test that `readConfig({})` rejects missing `DOMAIN`, `ALERT_FROM_EMAIL`,
`ALERT_TO_EMAIL`, and `RESEND_API_KEY`, and that a valid `.co.uk` configuration
is trimmed and normalized.

- [x] **Step 2: Verify the test fails**

Run: `node --test test/check-domain.test.js`
Expected: FAIL because `readConfig` is not exported.

- [x] **Step 3: Add package metadata and minimal configuration validation**

Create an ES module package with `test` and `check` scripts. Export
`readConfig(env)` from `check-domain.js`; reject missing values, invalid email
shapes, and domains that are not valid `.co.uk` hostnames.

- [x] **Step 4: Verify the tests pass**

Run: `npm test`
Expected: all configuration tests pass.

### Task 2: RDAP Classification And Retry

**Files:**
- Modify: `test/check-domain.test.js`
- Modify: `check-domain.js`

- [x] **Step 1: Add failing lookup tests**

Cover `200` as `registered`, `404` as `available`, unexpected statuses as
errors, retry of `429`/`5xx`, exhausted retries, and network errors. Supply
stubbed `fetch` and `sleep` functions.

- [x] **Step 2: Verify the tests fail**

Run: `npm test`
Expected: FAIL because `checkDomain` is not implemented.

- [x] **Step 3: Implement bounded RDAP retry and strict classification**

Export `checkDomain(domain, options)`. Encode the domain in the Nominet URL,
attempt at most three requests, retry only network errors, `429`, and `5xx`,
and throw descriptive errors for ambiguous results.

- [x] **Step 4: Verify the tests pass**

Run: `npm test`
Expected: all lookup tests pass.

### Task 3: Email And Orchestration

**Files:**
- Modify: `test/check-domain.test.js`
- Modify: `check-domain.js`

- [x] **Step 1: Add failing orchestration tests**

Verify registered domains do not send email, available domains send exactly one
email with the configured sender and recipient, and Resend API errors are
propagated.

- [x] **Step 2: Verify the tests fail**

Run: `npm test`
Expected: FAIL because `runMonitor` and `sendAvailabilityEmail` are absent.

- [x] **Step 3: Implement email delivery and CLI execution**

Export `sendAvailabilityEmail` and `runMonitor`. Treat a returned Resend
`error` as failure, log registered/available outcomes, and run the CLI only
when `check-domain.js` is the process entry point. Set `process.exitCode = 1`
for operational failures without logging secrets.

- [x] **Step 4: Verify the tests pass**

Run: `npm test`
Expected: all tests pass.

### Task 4: Workflow And Documentation

**Files:**
- Modify: `.github/workflows/check-domain.yml`
- Create: `README.md`
- Create: `package-lock.json`

- [x] **Step 1: Install and lock the Resend dependency**

Run: `npm install`
Expected: `package-lock.json` is created and Resend resolves successfully.

- [x] **Step 2: Harden the workflow**

Use cron `0 * * * *`, `permissions: contents: read`, a job timeout,
`npm ci`, `npm test`, then `npm run check`. Configure the fixed domain and
GitHub repository variables for sender/recipient, plus the Resend secret.

- [x] **Step 3: Document setup and behavior**

Explain `RESEND_API_KEY`, `ALERT_FROM_EMAIL`, `ALERT_TO_EMAIL`, verified Resend
sender requirements, manual runs, hourly scheduling limitations, and local
test/check commands.

- [x] **Step 4: Validate repository files**

Run: `npm test`
Expected: all tests pass.

Run: `npm run check` with no environment configuration.
Expected: exits nonzero with a clear missing-configuration error.

Run: `git diff --check`
Expected: no whitespace errors.

### Task 5: Final Requirement Verification

**Files:**
- Review all changed files.

- [x] **Step 1: Compare implementation to the approved specification**

Confirm single `.co.uk` domain scope, hourly execution, email-only alerts,
strict `200`/`404` classification, retry behavior, successful availability
runs, reproducible installation, tests, and setup documentation.

- [x] **Step 2: Run fresh full verification**

Run: `npm ci`
Expected: dependency installation succeeds.

Run: `npm test`
Expected: all tests pass with zero failures.

Run: `git diff --check`
Expected: no whitespace errors.
