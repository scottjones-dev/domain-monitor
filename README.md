# Domain Monitor

This repository checks `penruddockearms.co.uk` against the Nominet RDAP
service every hour. If the domain appears to be available, it sends an email
through Resend.

The monitored domain is fixed as `penruddockearms.co.uk` in
`.github/workflows/check-domain.yml`.

## Requirements

- Node.js 24 or later
- A Resend account and API key
- A sender domain verified in Resend

## Resend setup

Add and verify a domain in the Resend dashboard before enabling alerts. Resend
requires the DNS records it provides to be added to the sender domain. Wait
until Resend reports the domain as verified.

`ALERT_FROM_EMAIL` must use that verified sender domain, for example
`alerts@your-verified-domain.example`. The monitored domain does not need to be
the sender domain.

## GitHub Actions setup

In the GitHub repository, open:

**Settings > Secrets and variables > Actions**

Under **Secrets**, create:

- `RESEND_API_KEY`: your Resend API key

Under **Variables**, create:

- `ALERT_FROM_EMAIL`: the email address on your verified Resend sender domain
- `ALERT_TO_EMAIL`: the address that should receive availability alerts

Do not create a `DOMAIN` secret or variable. The workflow sets `DOMAIN` to
`penruddockearms.co.uk`.

## Running the monitor

The **Check Domain** workflow is scheduled hourly. GitHub Actions schedules are
not guaranteed to start at the exact scheduled time and may be delayed,
especially during periods of high demand.

To run it immediately:

1. Open the repository's **Actions** tab.
2. Select **Check Domain**.
3. Select **Run workflow**.

## Local development

Install dependencies and run the tests:

```powershell
npm install
npm test
```

To run the domain check locally, set all four required environment variables:

```powershell
$env:DOMAIN = "penruddockearms.co.uk"
$env:ALERT_FROM_EMAIL = "alerts@your-verified-domain.example"
$env:ALERT_TO_EMAIL = "you@example.com"
$env:RESEND_API_KEY = "re_your_api_key"
npm run check
```

The local check sends an email only when Nominet RDAP reports the domain as
available.
