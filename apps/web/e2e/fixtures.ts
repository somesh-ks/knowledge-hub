import { test as base, expect } from "@playwright/test";

/**
 * Every test fails if its page logs an error, throws, or breaks the Content-Security-Policy. The
 * policy is delivered both as a header (vercel.json, applied by the test server) and as a meta
 * element, so a violation here is a violation in production.
 */
export interface Problems {
  messages: string[];
}

interface Options {
  /** Set for a test that goes offline on purpose, where failed requests are expected. */
  allowNetworkErrors: boolean;
}

export const test = base.extend<Options & { problems: Problems }>({
  allowNetworkErrors: [false, { option: true }],
  problems: [
    async ({ page, allowNetworkErrors }, use) => {
      const problems: Problems = { messages: [] };
      // A page the test asks for on purpose and that answers 404 logs one console line for itself.
      const expectedNotFound = new Set<string>();
      page.on("response", (response) => {
        if (response.status() === 404 && response.request().isNavigationRequest()) {
          expectedNotFound.add(response.url());
        }
      });
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const text = message.text();
        if (expectedNotFound.has(message.location().url)) return;
        const isNetworkNoise =
          /Failed to load resource|net::ERR|Failed to fetch|Error hydrating/.test(text);
        if (allowNetworkErrors && isNetworkNoise) return;
        problems.messages.push(`console: ${text}`);
      });
      page.on("pageerror", (error) => problems.messages.push(`pageerror: ${error.message}`));
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (event) => {
          const holder = window as unknown as { __csp?: string[] };
          holder.__csp = holder.__csp ?? [];
          holder.__csp.push(`${event.violatedDirective} blocked ${event.blockedURI}`);
        });
      });
      await use(problems);
      const violations = await page
        .evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? [])
        .catch(() => []);
      expect([...problems.messages, ...violations.map((v) => `csp: ${v}`)]).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export const ROUTES = [
  { name: "home", path: "/" },
  { name: "latest digest", path: "/d/2026-10-07" },
  { name: "digest without audio", path: "/d/2026-10-05" },
  { name: "weekly digest", path: "/d/2026-10-04-weekly" },
  { name: "archive", path: "/archive" },
  { name: "offline page", path: "/offline" },
  { name: "not found", path: "/does-not-exist" },
] as const;

/** The fixture digest with an audio timeline. */
export const AUDIO_DIGEST = "/d/2026-10-07";
