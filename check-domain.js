import { pathToFileURL } from "node:url";
import { Resend } from "resend";

const REQUIRED_CONFIGURATION = [
  "DOMAIN",
  "ALERT_FROM_EMAIL",
  "ALERT_TO_EMAIL",
  "RESEND_API_KEY"
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CO_UK_DOMAIN_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+co\.uk$/;

export function readConfig(environment = process.env) {
  const config = {};

  for (const name of REQUIRED_CONFIGURATION) {
    const value = environment[name]?.trim();

    if (!value) {
      throw new Error(`${name} is required`);
    }

    config[name] = value;
  }

  config.DOMAIN = config.DOMAIN.toLowerCase().replace(/\.$/, "");

  if (!CO_UK_DOMAIN_PATTERN.test(config.DOMAIN)) {
    throw new Error("DOMAIN must be a valid .co.uk hostname");
  }

  for (const name of ["ALERT_FROM_EMAIL", "ALERT_TO_EMAIL"]) {
    if (!EMAIL_PATTERN.test(config[name])) {
      throw new Error(`${name} must be a valid email address`);
    }
  }

  return config;
}

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function checkDomain(
  domain,
  {
    fetchImpl = fetch,
    sleep = delay,
    maxAttempts = 3,
    retryDelayMs = 1_000,
    requestTimeoutMs = 10_000
  } = {}
) {
  const url = `https://rdap.nominet.uk/uk/domain/${encodeURIComponent(domain)}`;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response;
    const signal = AbortSignal.timeout(requestTimeoutMs);

    try {
      response = await fetchImpl(url, {
        headers: { Accept: "application/rdap+json" },
        signal
      });
    } catch (error) {
      const detail = signal.aborted
        ? `request timed out after ${requestTimeoutMs}ms`
        : error.message;

      if (attempt === maxAttempts) {
        throw new Error(
          `Nominet RDAP request failed after ${maxAttempts} attempts: ${detail}`,
          { cause: error }
        );
      }

      await sleep(retryDelayMs * attempt);
      continue;
    }

    if (!response || !Number.isInteger(response.status)) {
      const responseType = typeof response;
      const status =
        response && typeof response === "object"
          ? String(response.status)
          : "undefined";

      if (attempt === maxAttempts) {
        throw new Error(
          `Nominet RDAP request failed after ${maxAttempts} attempts: ` +
            `invalid response, type=${responseType}, status=${status}`
        );
      }

      await sleep(retryDelayMs * attempt);
      continue;
    }

    if (response.status === 200) {
      return "registered";
    }

    if (response.status === 404) {
      return "available";
    }

    const temporaryFailure =
      response.status === 429 || response.status >= 500;

    if (!temporaryFailure) {
      throw new Error(
        `Nominet RDAP returned unexpected status ${response.status}`
      );
    }

    if (attempt === maxAttempts) {
      throw new Error(
        `Nominet RDAP request failed after ${maxAttempts} attempts: status ${response.status}`
      );
    }

    await sleep(retryDelayMs * attempt);
  }

  throw new Error("Nominet RDAP request failed");
}

export async function sendAvailabilityEmail(
  config,
  {
    resendClient = new Resend(config.RESEND_API_KEY),
    requestTimeoutMs = 10_000
  } = {}
) {
  const signal = AbortSignal.timeout(requestTimeoutMs);
  let result;

  try {
    result = await resendClient.emails.send(
      {
        from: config.ALERT_FROM_EMAIL,
        to: config.ALERT_TO_EMAIL,
        subject: `DOMAIN AVAILABLE: ${config.DOMAIN}`,
        text:
          `${config.DOMAIN} appears to be available according to ` +
          "Nominet RDAP. Check and purchase it as soon as possible."
      },
      { signal }
    );
  } catch (error) {
    if (signal.aborted) {
      throw new Error(`Resend request timed out after ${requestTimeoutMs}ms`, {
        cause: error
      });
    }

    throw error;
  }

  if (result.error) {
    throw new Error(
      `Resend failed to send availability email: ${result.error.message}`
    );
  }

  return result.data;
}

export async function runMonitor(
  config,
  {
    checkDomainImpl = checkDomain,
    sendEmailImpl = sendAvailabilityEmail,
    logger = console
  } = {}
) {
  const status = await checkDomainImpl(config.DOMAIN);

  if (status === "registered") {
    logger.log(`${config.DOMAIN} is still registered.`);
    return status;
  }

  if (status !== "available") {
    throw new Error(`Unexpected domain status: ${status}`);
  }

  await sendEmailImpl(config);
  logger.log(`${config.DOMAIN} is available. Availability email sent.`);
  return status;
}

function isMainModule() {
  return Boolean(
    process.argv[1] &&
      pathToFileURL(process.argv[1]).href === import.meta.url
  );
}

if (isMainModule()) {
  try {
    const config = readConfig();
    await runMonitor(config);
  } catch (error) {
    console.error(`Domain monitor failed: ${error.message}`);
    process.exitCode = 1;
  }
}
