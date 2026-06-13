import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

globalThis.fetch = async () => ({ status: 200 });

const {
  checkDomain,
  fetchDomainRecord,
  formatDomainReport,
  readConfig,
  runMonitor,
  sendAvailabilityEmail
} = await import("../check-domain.js");

const validEnvironment = {
  DOMAIN: "penruddockearms.co.uk",
  ALERT_FROM_EMAIL: "alerts@example.com",
  ALERT_TO_EMAIL: "owner@example.com",
  RESEND_API_KEY: "re_test_key"
};

const sampleRdapRecord = {
  handle: "D_79496860-UK",
  ldhName: "penruddockearms.co.uk",
  unicodeName: "penruddockearms.co.uk",
  status: ["client hold", "pending delete", "redemption period", "server hold"],
  links: [
    {
      rel: "self",
      href: "https://rdap.nominet.uk/uk/domain/penruddockearms.co.uk"
    }
  ],
  events: [
    {
      eventAction: "registration",
      eventDate: "2023-03-25T12:10:54.421297Z"
    },
    {
      eventAction: "last changed",
      eventDate: "2026-03-25T05:21:14.786186Z"
    },
    {
      eventAction: "expiration",
      eventDate: "2026-03-25T12:10:54Z"
    },
    {
      eventAction: "last update of RDAP database",
      eventDate: "2026-06-13T08:35:04.517Z"
    }
  ],
  nameservers: [
    {
      ldhName: "ns0.thundercloud.uk.",
      ipAddresses: { v4: ["149.255.60.1"] }
    },
    {
      ldhName: "ns1.thundercloud.uk.",
      ipAddresses: { v4: ["185.53.57.60"] }
    }
  ],
  secureDNS: {
    maxSigLife: 3024000,
    delegationSigned: false
  },
  entities: [
    {
      roles: ["registrar"],
      publicIds: [{ type: "Registry Identifier", identifier: "LIVEDOMAINS" }],
      vcardArray: [
        "vcard",
        [
          ["version", {}, "text", "4.0"],
          ["fn", {}, "text", "Fasthosts Internet Ltd"],
          ["url", {}, "uri", "https://www.fasthosts.co.uk"]
        ]
      ],
      entities: [
        {
          roles: ["abuse"],
          vcardArray: [
            "vcard",
            [
              ["version", {}, "text", "4.0"],
              ["fn", {}, "text", "Abuse contact"],
              ["email", {}, "text", "misuse@fasthosts.co.uk"]
            ]
          ]
        }
      ]
    },
    {
      roles: ["registrant"],
      status: ["validated"],
      vcardArray: [
        "vcard",
        [
          ["version", {}, "text", "4.0"],
          ["fn", {}, "text", ""],
          ["email", {}, "text", "redacted@nominet.uk"]
        ]
      ],
      remarks: [
        {
          title: "REDACTED FOR PRIVACY",
          description: ["Some of the data in this object has been removed"]
        },
        {
          title: "Data Quality",
          description: [
            "Name validated.",
            "Address validated.",
            "Nominet responsible for validation."
          ]
        }
      ]
    }
  ],
  redacted: [
    {
      name: { type: "Registrant Name" },
      method: "emptyValue"
    },
    {
      name: { type: "Registrant Organization" },
      method: "removal"
    },
    {
      name: { type: "Registrant Email" },
      method: "replacementValue"
    },
    {
      name: { type: "Registrant Phone" },
      method: "removal"
    }
  ],
  notices: [
    {
      title: "Status Codes",
      description: [
        "For more information on domain status codes, please visit https://icann.org/epp"
      ]
    }
  ]
};

test("readConfig requires every configuration value", () => {
  assert.equal(typeof readConfig, "function");

  for (const name of Object.keys(validEnvironment)) {
    const environment = { ...validEnvironment };
    delete environment[name];

    assert.throws(
      () => readConfig(environment),
      new RegExp(`${name} is required`)
    );
  }
});

test("readConfig treats whitespace-only values as missing", () => {
  const whitespaceVariants = ["   ", "\t", "\n", " \t\n"];

  for (const name of Object.keys(validEnvironment)) {
    for (const value of whitespaceVariants) {
      const environment = { ...validEnvironment, [name]: value };

      assert.throws(
        () => readConfig(environment),
        new RegExp(`${name} is required`)
      );
    }
  }
});

test("readConfig normalizes valid configuration", () => {
  const config = readConfig({
    DOMAIN: "  PenRuddockeArms.CO.UK. ",
    ALERT_FROM_EMAIL: " alerts@example.com ",
    ALERT_TO_EMAIL: " owner@example.com ",
    RESEND_API_KEY: " re_test_key "
  });

  assert.deepEqual(config, validEnvironment);
});

test("readConfig rejects unsupported domains and invalid email addresses", () => {
  assert.throws(
    () => readConfig({ ...validEnvironment, DOMAIN: "example.com" }),
    /DOMAIN must be a valid \.co\.uk hostname/
  );
  assert.throws(
    () => readConfig({ ...validEnvironment, ALERT_FROM_EMAIL: "invalid" }),
    /ALERT_FROM_EMAIL must be a valid email address/
  );
  assert.throws(
    () => readConfig({ ...validEnvironment, ALERT_TO_EMAIL: "invalid" }),
    /ALERT_TO_EMAIL must be a valid email address/
  );
});

test("checkDomain classifies registered and available responses", async () => {
  let requestedUrl;
  const registered = await checkDomain(validEnvironment.DOMAIN, {
    fetchImpl: async (url) => {
      requestedUrl = url;
      return { status: 200 };
    }
  });
  const available = await checkDomain(validEnvironment.DOMAIN, {
    fetchImpl: async () => ({ status: 404 })
  });

  assert.equal(registered, "registered");
  assert.equal(available, "available");
  assert.equal(
    requestedUrl,
    `https://rdap.nominet.uk/uk/domain/${validEnvironment.DOMAIN}`
  );
});

test("fetchDomainRecord keeps RDAP details for registered domains", async () => {
  const record = await fetchDomainRecord(validEnvironment.DOMAIN, {
    fetchImpl: async () => ({
      status: 200,
      json: async () => sampleRdapRecord
    })
  });

  assert.equal(record.status, "registered");
  assert.equal(record.rdap, sampleRdapRecord);
});

test("fetchDomainRecord does not require RDAP details for available domains", async () => {
  const record = await fetchDomainRecord(validEnvironment.DOMAIN, {
    fetchImpl: async () => ({ status: 404 })
  });

  assert.deepEqual(record, {
    status: "available",
    rdap: null
  });
});

test("formatDomainReport renders the main Nominet RDAP sections", () => {
  const report = formatDomainReport(sampleRdapRecord);

  assert.equal(
    report,
    `Domain Information
Name: penruddockearms.co.uk
Internationalized Domain Name: penruddockearms.co.uk
Registry Domain ID: D_79496860-UK
Domain Status:
clientHold
pendingDelete
redemptionPeriod
serverHold

Nameservers:
ns0.thundercloud.uk. : 149.255.60.1
ns1.thundercloud.uk. : 185.53.57.60

Dates
Registry Expiration: 2026-03-25 12:10:54 UTC
Updated: 2026-03-25 05:21:14 UTC
Created: 2023-03-25 12:10:54 UTC

Contact Information
Registrant:
Name: The RDAP server redacted the value
Organization: The RDAP server redacted the value
Email: redacted@nominet.uk (The RDAP server replaced the value stored in the database with a different value)
Status: validated
Phone: The RDAP server redacted the value
REDACTED FOR PRIVACY:
Some of the data in this object has been removed
Data Quality:
Name validated.
Address validated.
Nominet responsible for validation.

Registrar Information
Name: Fasthosts Internet Ltd
IANA ID: LIVEDOMAINS
URL: https://www.fasthosts.co.uk
Abuse contact email: misuse@fasthosts.co.uk

DNSSEC Information
Max sig life: 3024000
Delegation Signed: Unsigned

Authoritative Servers
Registry Server URL: https://rdap.nominet.uk/uk/domain/penruddockearms.co.uk
Last updated from Registry RDAP DB: 2026-06-13 08:35:04 UTC

Notices and Remarks
Status Codes:
For more information on domain status codes, please visit https://icann.org/epp`
  );
});

test("formatDomainReport distinguishes missing DNSSEC delegation from unsigned", () => {
  const report = formatDomainReport({
    ...sampleRdapRecord,
    secureDNS: {}
  });

  assert.match(report, /Delegation Signed: Not listed/);
});

test("checkDomain encodes the domain and requests RDAP JSON", async () => {
  let request;

  await checkDomain("example name.co.uk", {
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { status: 200 };
    }
  });

  assert.equal(
    request.url,
    "https://rdap.nominet.uk/uk/domain/example%20name.co.uk"
  );
  assert.equal(request.options.headers.Accept, "application/rdap+json");
  assert.ok(request.options.signal instanceof AbortSignal);
});

test("checkDomain rejects unexpected response statuses", async () => {
  await assert.rejects(
    checkDomain(validEnvironment.DOMAIN, {
      fetchImpl: async () => ({ status: 403 })
    }),
    /Nominet RDAP returned unexpected status 403/
  );
});

test("checkDomain retries temporary HTTP failures", async () => {
  const statuses = [503, 429, 200];
  const delays = [];

  const result = await checkDomain(validEnvironment.DOMAIN, {
    fetchImpl: async () => ({ status: statuses.shift() }),
    sleep: async (milliseconds) => delays.push(milliseconds),
    retryDelayMs: 10
  });

  assert.equal(result, "registered");
  assert.deepEqual(delays, [10, 20]);
});

test("checkDomain retries network failures", async () => {
  let attempts = 0;

  const result = await checkDomain(validEnvironment.DOMAIN, {
    fetchImpl: async () => {
      attempts += 1;
      if (attempts < 2) {
        throw new Error("connection reset");
      }
      return { status: 404 };
    },
    sleep: async () => {}
  });

  assert.equal(result, "available");
  assert.equal(attempts, 2);
});

test("checkDomain fails after temporary errors exhaust retries", async () => {
  let attempts = 0;

  await assert.rejects(
    checkDomain(validEnvironment.DOMAIN, {
      fetchImpl: async () => {
        attempts += 1;
        return { status: 503 };
      },
      sleep: async () => {}
    }),
    /Nominet RDAP request failed after 3 attempts: status 503/
  );

  assert.equal(attempts, 3);
});

test("checkDomain retries malformed responses and never classifies them", async () => {
  let attempts = 0;

  await assert.rejects(
    checkDomain(validEnvironment.DOMAIN, {
      fetchImpl: async () => {
        attempts += 1;
        return {};
      },
      sleep: async () => {}
    }),
    /Nominet RDAP request failed after 3 attempts: invalid response, type=object, status=undefined/
  );

  assert.equal(attempts, 3);
});

test("checkDomain times out stalled requests before retrying", async () => {
  let attempts = 0;

  await assert.rejects(
    checkDomain(validEnvironment.DOMAIN, {
      fetchImpl: async (_url, { signal }) => {
        attempts += 1;
        await new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true
          });
        });
      },
      maxAttempts: 2,
      requestTimeoutMs: 5,
      retryDelayMs: 0,
      sleep: async () => {}
    }),
    /Nominet RDAP request failed after 2 attempts: request timed out after 5ms/
  );

  assert.equal(attempts, 2);
});

test("sendAvailabilityEmail sends an actionable message", async () => {
  let sentMessage;
  const resendClient = {
    emails: {
      send: async (message) => {
        sentMessage = message;
        return { data: { id: "email-id" }, error: null };
      }
    }
  };

  await sendAvailabilityEmail(validEnvironment, { resendClient });

  assert.deepEqual(sentMessage, {
    from: validEnvironment.ALERT_FROM_EMAIL,
    to: validEnvironment.ALERT_TO_EMAIL,
    subject: `DOMAIN AVAILABLE: ${validEnvironment.DOMAIN}`,
    text:
      `${validEnvironment.DOMAIN} appears to be available according to ` +
      "Nominet RDAP. Check and purchase it as soon as possible."
  });
});

test("sendAvailabilityEmail propagates Resend API errors", async () => {
  const resendClient = {
    emails: {
      send: async () => ({
        data: null,
        error: { message: "sender domain is not verified" }
      })
    }
  };

  await assert.rejects(
    sendAvailabilityEmail(validEnvironment, { resendClient }),
    /Resend failed to send availability email: sender domain is not verified/
  );
});

test("sendAvailabilityEmail times out stalled Resend requests", async () => {
  const resendClient = {
    emails: {
      send: async (_message, { signal }) => {
        await new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true
          });
        });
      }
    }
  };

  await assert.rejects(
    sendAvailabilityEmail(validEnvironment, {
      resendClient,
      requestTimeoutMs: 5
    }),
    /Resend request timed out after 5ms/
  );
});

test("sendAvailabilityEmail rethrows non-timeout Resend errors", async () => {
  const networkError = new Error("network failure");
  const resendClient = {
    emails: {
      send: async (_message, { signal }) => {
        assert.equal(signal.aborted, false);
        throw networkError;
      }
    }
  };

  await assert.rejects(
    sendAvailabilityEmail(validEnvironment, { resendClient }),
    (error) => error === networkError
  );
});

test("runMonitor does not send email for a registered domain", async () => {
  let emailsSent = 0;
  const messages = [];

  const result = await runMonitor(validEnvironment, {
    fetchDomainRecordImpl: async () => ({
      status: "registered",
      rdap: null
    }),
    sendEmailImpl: async () => {
      emailsSent += 1;
    },
    logger: { log: (message) => messages.push(message) }
  });

  assert.equal(result, "registered");
  assert.equal(emailsSent, 0);
  assert.deepEqual(messages, [
    `${validEnvironment.DOMAIN} is still registered.`
  ]);
});

test("runMonitor logs the full RDAP report for registered domains", async () => {
  let emailsSent = 0;
  const messages = [];

  const result = await runMonitor(validEnvironment, {
    fetchDomainRecordImpl: async () => ({
      status: "registered",
      rdap: sampleRdapRecord
    }),
    sendEmailImpl: async () => {
      emailsSent += 1;
    },
    logger: { log: (message) => messages.push(message) }
  });

  assert.equal(result, "registered");
  assert.equal(emailsSent, 0);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /^Domain Information\nName: penruddockearms\.co\.uk/);
  assert.match(
    messages[0],
    /Registrar Information\nName: Fasthosts Internet Ltd/
  );
});

test("runMonitor sends one email for an available domain", async () => {
  let emailConfig;
  const messages = [];

  const result = await runMonitor(validEnvironment, {
    fetchDomainRecordImpl: async () => ({
      status: "available",
      rdap: null
    }),
    sendEmailImpl: async (config) => {
      emailConfig = config;
    },
    logger: { log: (message) => messages.push(message) }
  });

  assert.equal(result, "available");
  assert.equal(emailConfig, validEnvironment);
  assert.deepEqual(messages, [
    `${validEnvironment.DOMAIN} is available. Availability email sent.`
  ]);
});

test("runMonitor rejects ambiguous results without sending email", async () => {
  let emailsSent = 0;

  await assert.rejects(
    runMonitor(validEnvironment, {
      fetchDomainRecordImpl: async () => ({
        status: "unknown",
        rdap: null
      }),
      sendEmailImpl: async () => {
        emailsSent += 1;
      },
      logger: { log: () => {} }
    }),
    /Unexpected domain status: unknown/
  );

  assert.equal(emailsSent, 0);
});

test("importing the module does not execute a domain check", () => {
  const moduleUrl = new URL("../check-domain.js", import.meta.url).href;
  const script = `
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return { status: 200 };
    };
    await import(${JSON.stringify(moduleUrl)});
    console.log(calls);
  `;

  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "0");
});
