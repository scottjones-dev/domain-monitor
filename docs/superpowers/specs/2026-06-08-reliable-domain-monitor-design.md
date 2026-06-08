# Reliable Domain Monitor Design

## Goal

Monitor `penruddockearms.co.uk` once per hour and email the owner whenever
Nominet RDAP confirms that the domain is available.

The first version is intentionally limited to one `.co.uk` domain and email
notifications. It should be dependable enough that a failed API request or
configuration problem is visible instead of being treated as a valid result.

## Architecture

The project remains a small Node.js command-line program run by GitHub Actions.
The workflow supplies configuration through environment variables, and the
program performs one RDAP lookup followed by an optional Resend email.

The implementation will separate these responsibilities into testable
functions:

- Parse and validate environment configuration.
- Query the Nominet RDAP endpoint.
- Classify the response as registered, available, or an operational failure.
- Send an availability email through Resend.
- Coordinate the check and set an appropriate process exit status.

No database, server, persistent state, or multi-domain configuration will be
added in this version.

## Configuration

The GitHub Actions workflow will provide:

- `DOMAIN`, set to `penruddockearms.co.uk`.
- `ALERT_FROM_EMAIL`, the Resend-verified sender address.
- `ALERT_TO_EMAIL`, the notification recipient.
- `RESEND_API_KEY`, stored as a GitHub Actions secret.

The program will fail before making a request if a required value is missing or
if `DOMAIN` is not a valid `.co.uk` hostname. Email addresses will not be
hard-coded in the JavaScript source.

## Domain Check

The program will request:

`https://rdap.nominet.uk/uk/domain/<encoded-domain>`

Results will be interpreted strictly:

- `200`: the domain is registered; log the result and exit successfully.
- `404`: Nominet confirms no matching registration; send an availability email.
- `429` or `5xx`: retry a small, bounded number of times with delay.
- Any other status: report an operational failure and exit unsuccessfully.
- Network errors and invalid response handling: retry when appropriate, then
  report failure.

A failed or ambiguous request must never trigger an availability email.

## Email Behavior

For each confirmed `404`, Resend will send one plain, actionable email naming
the domain and stating that Nominet RDAP reported it as available.

The monitor will send an email on every hourly run while the domain continues
to return `404`. Repeat suppression is excluded because it would require
persistent state and could reduce the chance of noticing the result.

If email delivery fails, the run will fail and log the error without exposing
the API key.

## Workflow

GitHub Actions will:

- Run hourly using `0 * * * *`.
- Support manual `workflow_dispatch` execution.
- Use the current Node.js LTS release supported by the project.
- Install exact dependencies with `npm ci`.
- Run automated tests before executing the live domain check.
- Apply a job timeout and least-privilege repository permissions.

The workflow run should remain successful when the domain is registered. A
confirmed available result should also remain successful after the email is
sent; availability is a business event, not a software failure.

## Package And Tests

The repository will gain a `package.json` and lockfile so GitHub Actions can
install Resend reproducibly. Node's built-in test runner will avoid adding a
test framework.

Tests will cover:

- Missing or invalid configuration.
- Registered (`200`) and available (`404`) classifications.
- Unexpected HTTP statuses.
- Retry behavior for temporary failures.
- Email sent only for a confirmed `404`.
- Email delivery failure propagation.

Network and email clients will be injected or mocked so tests make no live
requests.

## Operational Notes

GitHub Actions schedules are not real-time and may start late during periods of
high demand. An hourly schedule therefore means approximately hourly, not an
exact guarantee.

Resend must authorize the configured sender domain before the workflow can
deliver mail. Setup requirements will be recorded in a short README, including
the required GitHub secret and variables.

## Out Of Scope

- Monitoring multiple domains.
- Extensions other than `.co.uk`.
- Discord or other notification channels.
- Automatic domain purchasing.
- Persistent history or repeat-notification suppression.
- A web interface or continuously running service.
