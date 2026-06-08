import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

globalThis.fetch = async () => ({ status: 200 });

const {
  checkDomain,
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
    /Nominet RDAP request failed after 3 attempts: invalid response/
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

test("runMonitor does not send email for a registered domain", async () => {
  let emailsSent = 0;
  const messages = [];

  const result = await runMonitor(validEnvironment, {
    checkDomainImpl: async () => "registered",
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

test("runMonitor sends one email for an available domain", async () => {
  let emailConfig;
  const messages = [];

  const result = await runMonitor(validEnvironment, {
    checkDomainImpl: async () => "available",
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
      checkDomainImpl: async () => "unknown",
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
