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

async function readRdapJson(response) {
  if (!response || typeof response.json !== "function") {
    return null;
  }

  const body = await response.json();
  return body && typeof body === "object" && !Array.isArray(body)
    ? body
    : null;
}

export async function fetchDomainRecord(
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
      return {
        status: "registered",
        rdap: await readRdapJson(response)
      };
    }

    if (response.status === 404) {
      return {
        status: "available",
        rdap: null
      };
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

export async function checkDomain(domain, options = {}) {
  const record = await fetchDomainRecord(domain, options);
  return record.status;
}

function findEntityByRole(record, role) {
  return record.entities?.find((entity) => entity.roles?.includes(role));
}

function findNestedEntityByRole(entity, role) {
  return entity?.entities?.find((nested) => nested.roles?.includes(role));
}

function findVcardValue(entity, name) {
  const properties = entity?.vcardArray?.[1];

  if (!Array.isArray(properties)) {
    return null;
  }

  const property = properties.find(([propertyName]) => propertyName === name);
  const value = property?.[3];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function findRedactedField(record, name) {
  return record.redacted?.find((entry) => {
    const entryName = entry.name?.type ?? entry.name?.description;
    return entryName === name;
  });
}

function redactedAwareValue(record, fieldName, value) {
  const redaction = findRedactedField(record, fieldName);

  if (value && redaction?.method === "replacementValue") {
    return (
      `${value} (` +
      "The RDAP server replaced the value stored in the database with a different value)"
    );
  }

  if (value) {
    return value;
  }

  if (redaction) {
    return "The RDAP server redacted the value";
  }

  return "Not listed";
}

function toEppStatus(status) {
  return String(status)
    .trim()
    .split(/\s+/)
    .map((word, index) =>
      index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join("");
}

function formatRdapDate(value) {
  if (!value) {
    return "Not listed";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

function findEventDate(record, action) {
  return record.events?.find((event) => event.eventAction === action)?.eventDate;
}

function nameserverAddress(nameserver) {
  const addresses = [
    ...(nameserver.ipAddresses?.v4 ?? []),
    ...(nameserver.ipAddresses?.v6 ?? [])
  ];

  return addresses.length > 0 ? addresses.join(", ") : "No IP addresses listed";
}

function publicIdentifier(entity) {
  return entity?.publicIds?.find((publicId) => publicId.identifier)?.identifier;
}

function appendRemarks(lines, remarks = []) {
  for (const remark of remarks) {
    if (remark.title) {
      lines.push(`${remark.title}:`);
    }

    for (const description of remark.description ?? []) {
      lines.push(description);
    }
  }
}

function formatDelegationSigned(secureDNS) {
  if (typeof secureDNS?.delegationSigned !== "boolean") {
    return "Not listed";
  }

  return secureDNS.delegationSigned ? "Signed" : "Unsigned";
}

export function formatDomainReport(record) {
  const registrar = findEntityByRole(record, "registrar");
  const registrant = findEntityByRole(record, "registrant");
  const abuseContact = findNestedEntityByRole(registrar, "abuse");
  const registryLink = record.links?.find((link) => link.rel === "self")?.href;
  const updatedFromRegistry = formatRdapDate(
    findEventDate(record, "last update of RDAP database")
  );

  const lines = [
    "Domain Information",
    `Name: ${record.ldhName ?? "Not listed"}`,
    `Internationalized Domain Name: ${record.unicodeName ?? "Not listed"}`,
    `Registry Domain ID: ${record.handle ?? "Not listed"}`,
    "Domain Status:"
  ];

  const statuses = record.status?.length
    ? record.status.map(toEppStatus)
    : ["Not listed"];
  lines.push(...statuses);

  lines.push("", "Nameservers:");
  const nameservers = record.nameservers?.length ? record.nameservers : [];

  if (nameservers.length === 0) {
    lines.push("Not listed");
  } else {
    for (const nameserver of nameservers) {
      lines.push(
        `${nameserver.ldhName ?? nameserver.unicodeName ?? "Not listed"} : ${nameserverAddress(nameserver)}`
      );
    }
  }

  lines.push(
    "",
    "Dates",
    `Registry Expiration: ${formatRdapDate(findEventDate(record, "expiration"))}`,
    `Updated: ${formatRdapDate(findEventDate(record, "last changed"))}`,
    `Created: ${formatRdapDate(findEventDate(record, "registration"))}`,
    "",
    "Contact Information",
    "Registrant:",
    `Name: ${redactedAwareValue(record, "Registrant Name", findVcardValue(registrant, "fn"))}`,
    `Organization: ${redactedAwareValue(record, "Registrant Organization", findVcardValue(registrant, "org"))}`,
    `Email: ${redactedAwareValue(record, "Registrant Email", findVcardValue(registrant, "email"))}`,
    `Status: ${registrant?.status?.join(", ") ?? "Not listed"}`,
    `Phone: ${redactedAwareValue(record, "Registrant Phone", findVcardValue(registrant, "tel"))}`
  );

  appendRemarks(lines, registrant?.remarks);

  lines.push(
    "",
    "Registrar Information",
    `Name: ${findVcardValue(registrar, "fn") ?? "Not listed"}`,
    `IANA ID: ${publicIdentifier(registrar) ?? "Not listed"}`,
    `URL: ${findVcardValue(registrar, "url") ?? "Not listed"}`,
    `Abuse contact email: ${findVcardValue(abuseContact, "email") ?? "Not listed"}`,
    "",
    "DNSSEC Information",
    `Max sig life: ${record.secureDNS?.maxSigLife ?? "Not listed"}`,
    `Delegation Signed: ${formatDelegationSigned(record.secureDNS)}`,
    "",
    "Authoritative Servers",
    `Registry Server URL: ${registryLink ?? "Not listed"}`,
    `Last updated from Registry RDAP DB: ${updatedFromRegistry}`,
    "",
    "Notices and Remarks"
  );

  appendRemarks(lines, record.notices);

  if (lines.at(-1) === "Notices and Remarks") {
    lines.push("None listed");
  }

  return lines.join("\n");
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
    fetchDomainRecordImpl = fetchDomainRecord,
    sendEmailImpl = sendAvailabilityEmail,
    logger = console
  } = {}
) {
  const record = await fetchDomainRecordImpl(config.DOMAIN);
  const { status } = record;

  if (status === "registered") {
    logger.log(
      record.rdap
        ? formatDomainReport(record.rdap)
        : `${config.DOMAIN} is still registered.`
    );
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
