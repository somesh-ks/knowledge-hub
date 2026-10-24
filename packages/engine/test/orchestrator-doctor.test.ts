import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeDoctorCommand } from "../src/commands/doctor.js";
import type { GitResult, GitRunner } from "../src/git/runGit.js";
import type { DoctorDeps, DoctorReport } from "../src/ops/doctor.js";
import type { BlobClient } from "../src/publish/blob.js";
import { captureStdout, makeContext } from "./curate-helpers.js";
import { json, sourcesFile } from "./orchestrator-fixtures.js";
import { FIXTURE_CONFIG, REPO_ROOT } from "./score-factories.js";

const SECRETS = {
  TYPESAFE_API_KEY: "ts-secret-111111111111",
  ANTHROPIC_API_KEY: "an-secret-222222222222",
  EXA_API_KEY: "exa-secret-333333333333",
  FIRECRAWL_API_KEY: "fc-secret-444444444444",
  SPEECHIFY_API_KEY: "sp-secret-555555555555",
  BLOB_READ_WRITE_TOKEN: "blob-secret-666666666666",
  VERCEL_TOKEN: "vc-secret-777777777777",
};

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "singularity-doctor-"));
  for (const file of ["config/preferences.json", "config/voice.md"]) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await cp(join(FIXTURE_CONFIG, basename(file)), join(root, file));
  }
  await cp(join(REPO_ROOT, "config/models.json"), join(root, "config/models.json"));
  await writeFile(join(root, "config/sources.json"), json(sourcesFile()), "utf8");
  await writeFile(
    join(root, "config/queries.json"),
    '{ "version": 1, "queries": [{ "id": "q", "query": "design" }] }',
    "utf8",
  );
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const ok = (stdout = ""): GitResult => ({ code: 0, stdout, stderr: "" });

function fakeGit(overrides: Record<string, GitResult> = {}): GitRunner {
  const table: Record<string, GitResult> = {
    "--version": ok("git version 2.50.0"),
    "rev-parse --is-inside-work-tree": ok("true\n"),
    "remote get-url origin": ok("git@github.com:somesh-ks/knowledge-hub.git"),
    "status --porcelain": ok(""),
    ...overrides,
  };
  return async (args) => table[args.join(" ")] ?? { code: 1, stdout: "", stderr: "unexpected" };
}

function reply(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

const GOOD_ROUTES: Record<string, () => Response> = {
  "https://api.anthropic.com/v1/models?limit=1": () => reply(200, { data: [] }),
  "https://api.exa.ai/search": () => reply(200, { results: [] }),
  "https://api.firecrawl.dev/v2/team/credit-usage": () =>
    reply(200, { success: true, data: { remainingCredits: 950 } }),
  "https://api.speechify.ai/v1/voices": () => reply(200, [{ id: "geffen_32" }, { id: "henry" }]),
  "https://api.vercel.com/v2/user": () => reply(200, { user: { id: "u" } }),
};

interface Seen {
  url: string;
  headers: Record<string, string>;
}

function fakeFetch(routes: Record<string, () => Response> = GOOD_ROUTES) {
  const calls: Seen[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    // Routes are keyed by path; the doctor adds paging parameters to some requests.
    const route = routes[url] ?? routes[url.split("?")[0] ?? url];
    if (!route) throw new Error(`no route for ${url}`);
    return route();
  };
  return { fetchImpl, calls };
}

const okBlob: BlobClient = {
  put: async () => ({ url: "https://x", pathname: "x" }),
  del: async () => {},
  list: async () => ({ blobs: [], hasMore: false }),
};

function deps(overrides: Partial<DoctorDeps> = {}): Partial<DoctorDeps> {
  return {
    nodeVersion: "26.7.0",
    git: fakeGit(),
    fetchImpl: fakeFetch().fetchImpl,
    createJev: () => ({ systemOne: async () => ({ answers: {} }) }),
    createBlob: () => okBlob,
    timeoutMs: 1_000,
    ...overrides,
  };
}

async function doctor(
  args: string[],
  options: { env?: Record<string, string>; deps?: Partial<DoctorDeps>; json?: boolean } = {},
): Promise<{ code: number; stdout: string; report?: DoctorReport }> {
  const { ctx } = makeContext(root, { env: options.env ?? {}, json: options.json ?? true });
  const { result, stdout } = await captureStdout(() =>
    makeDoctorCommand(deps(options.deps))(args, ctx),
  );
  const parsed = (ctx.json && stdout.trim() !== "" ? JSON.parse(stdout) : undefined) as
    | DoctorReport
    | undefined;
  return { code: result, stdout, ...(parsed ? { report: parsed } : {}) };
}

function check(report: DoctorReport | undefined, id: string) {
  const found = report?.checks.find((c) => c.id === id);
  if (!found) throw new Error(`no check ${id}`);
  return found;
}

describe("doctor: offline", () => {
  it("passes on a healthy repository and exits 0, warnings included", async () => {
    const { code, report } = await doctor([]);
    expect(code).toBe(0);
    expect(report).toMatchObject({ version: 1, online: false, ok: true });
    expect(report?.totals.fail).toBe(0);
    for (const id of ["node", "git", "repo", "remote", "tree"]) {
      expect(check(report, id).status).toBe("ok");
    }
    for (const id of ["config.preferences", "config.sources", "config.queries", "config.voice"]) {
      expect(check(report, id).status).toBe("ok");
    }
  });

  it("reports state files that do not exist yet as fine and corrupt ones as failures", async () => {
    await mkdir(join(root, "state"), { recursive: true });
    await writeFile(join(root, "state/seen.json"), "{ not json", "utf8");
    await writeFile(join(root, "state/last-run.json"), '{ "version": 1 }', "utf8");
    const { code, report } = await doctor([]);
    expect(code).toBe(1);
    expect(check(report, "state.seen").status).toBe("fail");
    expect(check(report, "state.seen").hint).toContain("git checkout -- state/seen.json");
    expect(check(report, "state.last-run").status).toBe("ok");
    expect(check(report, "state.judgments")).toMatchObject({
      status: "ok",
      summary: "not created yet",
    });
  });

  it("fails on Node older than 24", async () => {
    const { code, report } = await doctor([], { deps: { nodeVersion: "22.11.0" } });
    expect(code).toBe(1);
    expect(check(report, "node")).toMatchObject({ status: "fail" });
    expect(check(report, "node").hint).toContain("Node 24");
  });

  it("fails when git is missing", async () => {
    const throwing: GitRunner = async () => {
      throw Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" });
    };
    const { code, report } = await doctor([], { deps: { git: throwing } });
    expect(code).toBe(1);
    expect(check(report, "git").summary).toContain("not installed");
  });

  it("fails outside a git working tree", async () => {
    const git = fakeGit({
      "rev-parse --is-inside-work-tree": { code: 128, stdout: "", stderr: "fatal" },
    });
    const { report } = await doctor([], { deps: { git } });
    expect(check(report, "repo").status).toBe("fail");
  });

  it("warns, without failing, about a missing remote and a dirty tree", async () => {
    const git = fakeGit({
      "remote get-url origin": { code: 2, stdout: "", stderr: "" },
      "status --porcelain": ok(" M config/preferences.json\n?? notes.txt\n"),
    });
    const { code, report } = await doctor([], { deps: { git } });
    expect(code).toBe(0);
    expect(check(report, "remote").status).toBe("warn");
    expect(check(report, "tree")).toMatchObject({
      status: "warn",
      summary: "2 uncommitted changes",
    });
  });

  it("fails on missing or invalid config files and says how to fix them", async () => {
    await rm(join(root, "config/preferences.json"));
    await writeFile(
      join(root, "config/sources.json"),
      '{ "version": 1, "sources": [{ "id": "x" }] }',
      "utf8",
    );
    await writeFile(join(root, "config/voice.md"), "# Singularity voice\n", "utf8");
    const { code, report } = await doctor([]);
    expect(code).toBe(1);
    expect(check(report, "config.preferences")).toMatchObject({ status: "fail" });
    expect(check(report, "config.sources")).toMatchObject({ status: "fail" });
    expect(check(report, "config.sources").hint).toContain("sources import");
    expect(check(report, "config.voice").status).toBe("fail");
  });

  it("lists key names as set or missing and never prints a value", async () => {
    const { report, stdout } = await doctor([], {
      env: { ANTHROPIC_API_KEY: SECRETS.ANTHROPIC_API_KEY, EXA_API_KEY: SECRETS.EXA_API_KEY },
    });
    expect(check(report, "key.ANTHROPIC_API_KEY")).toMatchObject({ status: "ok", summary: "set" });
    expect(check(report, "key.TYPESAFE_API_KEY").status).toBe("warn");
    expect(check(report, "key.TYPESAFE_API_KEY").hint).toContain("unverified");
    for (const value of Object.values(SECRETS)) expect(stdout).not.toContain(value);
  });

  it("prints ok, warn and fail with fix hints as text, and totals", async () => {
    const { stdout, code } = await doctor([], { json: false, deps: { nodeVersion: "20.0.0" } });
    expect(code).toBe(1);
    expect(stdout).toContain("FAIL  node");
    expect(stdout).toContain("warn  key.TYPESAFE_API_KEY");
    expect(stdout).toContain("fix: ");
    expect(stdout).toContain("add --online to check the services");
  });

  it("makes no network request without --online", async () => {
    const net = fakeFetch();
    await doctor([], { env: { ...SECRETS }, deps: { fetchImpl: net.fetchImpl } });
    expect(net.calls).toEqual([]);
  });

  it("exits 2 for an unknown flag", async () => {
    expect((await doctor(["--bogus"])).code).toBe(2);
  });
});

describe("doctor: --online", () => {
  const env = { ...SECRETS };

  it("passes every service check when the services answer", async () => {
    const net = fakeFetch();
    const { code, report } = await doctor(["--online"], {
      env,
      deps: { fetchImpl: net.fetchImpl },
    });
    expect(code).toBe(0);
    expect(report?.online).toBe(true);
    expect(check(report, "online.anthropic").status).toBe("ok");
    expect(check(report, "online.jev").status).toBe("ok");
    expect(check(report, "online.exa").status).toBe("ok");
    expect(check(report, "online.firecrawl").summary).toBe("950 credits left");
    expect(check(report, "online.speechify").summary).toContain("geffen_32");
    expect(check(report, "online.blob").status).toBe("ok");
    expect(check(report, "online.vercel").status).toBe("ok");
  });

  it("fails when Vercel rejects the account token", async () => {
    const net = fakeFetch({
      ...GOOD_ROUTES,
      "https://api.vercel.com/v2/user": () => reply(404, { error: { message: "User not found" } }),
    });
    const { code, report } = await doctor(["--online"], {
      env,
      deps: { fetchImpl: net.fetchImpl },
    });
    expect(code).toBe(1);
    const failed = check(report, "online.vercel");
    expect(failed.status).toBe("fail");
    expect(failed.hint).toContain("secrets:push");
  });

  it("follows the voice cursor so a voice past the first page still counts", async () => {
    const pages = [
      reply(200, { voices: [{ id: "aadi" }], has_more: true, next_cursor: "c1" }),
      reply(200, { voices: [{ id: "geffen_32" }], has_more: false, next_cursor: "" }),
    ];
    const net = fakeFetch({
      ...GOOD_ROUTES,
      "https://api.speechify.ai/v1/voices": () => pages.shift() ?? reply(500, "extra page"),
    });
    const { report } = await doctor(["--online"], { env, deps: { fetchImpl: net.fetchImpl } });
    expect(check(report, "online.speechify").status).toBe("ok");
    expect(net.calls.filter((call) => call.url.includes("/v1/voices"))).toHaveLength(2);
    expect(net.calls.some((call) => call.url.includes("cursor=c1"))).toBe(true);
  });

  it("sends each key only to its own service and never prints one", async () => {
    const net = fakeFetch();
    const { stdout } = await doctor(["--online"], { env, deps: { fetchImpl: net.fetchImpl } });
    const anthropic = net.calls.find((c) => c.url.includes("anthropic"));
    expect(anthropic?.headers["x-api-key"]).toBe(SECRETS.ANTHROPIC_API_KEY);
    expect(net.calls.find((c) => c.url.includes("exa.ai"))?.headers["x-api-key"]).toBe(
      SECRETS.EXA_API_KEY,
    );
    for (const call of net.calls) {
      for (const [name, value] of Object.entries(SECRETS)) {
        const owner = call.url.includes("anthropic")
          ? "ANTHROPIC"
          : call.url.includes("exa")
            ? "EXA"
            : call.url.includes("firecrawl")
              ? "FIRECRAWL"
              : call.url.includes("vercel")
                ? "VERCEL"
                : "SPEECHIFY";
        if (!name.startsWith(owner)) expect(JSON.stringify(call.headers)).not.toContain(value);
      }
    }
    for (const value of Object.values(SECRETS)) expect(stdout).not.toContain(value);
  });

  it("fails a rejected key without echoing it", async () => {
    const net = fakeFetch({
      ...GOOD_ROUTES,
      "https://api.anthropic.com/v1/models?limit=1": () =>
        reply(401, { error: SECRETS.ANTHROPIC_API_KEY }),
    });
    const { code, report, stdout } = await doctor(["--online"], {
      env,
      deps: { fetchImpl: net.fetchImpl },
    });
    expect(code).toBe(1);
    expect(check(report, "online.anthropic")).toMatchObject({
      status: "fail",
      summary: "Anthropic rejected the key (HTTP 401)",
    });
    expect(check(report, "online.anthropic").hint).toContain("ANTHROPIC_API_KEY");
    expect(stdout).not.toContain(SECRETS.ANTHROPIC_API_KEY);
  });

  it("warns, not fails, when a service is rate limited or down", async () => {
    const net = fakeFetch({
      ...GOOD_ROUTES,
      "https://api.exa.ai/search": () => reply(429, "slow down"),
      "https://api.speechify.ai/v1/voices": () => reply(503, "unavailable"),
    });
    const { code, report } = await doctor(["--online"], {
      env,
      deps: { fetchImpl: net.fetchImpl },
    });
    expect(code).toBe(0);
    expect(check(report, "online.exa").status).toBe("warn");
    expect(check(report, "online.speechify").status).toBe("warn");
  });

  it("redacts a key that a network error message contains", async () => {
    const net = fakeFetch({
      ...GOOD_ROUTES,
      "https://api.exa.ai/search": () => {
        throw new Error(`socket hang up for ${SECRETS.EXA_API_KEY}`);
      },
    });
    const { code, report, stdout } = await doctor(["--online"], {
      env,
      deps: { fetchImpl: net.fetchImpl },
    });
    expect(code).toBe(1);
    expect(check(report, "online.exa").summary).toContain("unreachable");
    expect(stdout).not.toContain(SECRETS.EXA_API_KEY);
  });

  it("times out a service that never answers", async () => {
    const hang: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    const { code, report } = await doctor(["--online"], {
      env,
      deps: { fetchImpl: hang, timeoutMs: 20 },
    });
    expect(code).toBe(1);
    expect(check(report, "online.anthropic").summary).toContain("timed out after 20 ms");
  });

  it("checks Jev with a trivial question, and maps its errors", async () => {
    let asked = 0;
    const ready = await doctor(["--online"], {
      env,
      deps: {
        createJev: () => ({
          systemOne: async (request) => {
            asked += 1;
            expect(Object.keys(request.questions)).toEqual(["ready"]);
            return {};
          },
        }),
      },
    });
    expect(asked).toBe(1);
    expect(check(ready.report, "online.jev").status).toBe("ok");

    const limited = await doctor(["--online"], {
      env,
      deps: {
        createJev: () => ({
          systemOne: async () => Promise.reject(Object.assign(new Error("slow"), { status: 429 })),
        }),
      },
    });
    expect(check(limited.report, "online.jev").status).toBe("warn");
    const rejected = await doctor(["--online"], {
      env,
      deps: {
        createJev: () => ({
          systemOne: async () => Promise.reject(Object.assign(new Error("no"), { status: 401 })),
        }),
      },
    });
    expect(check(rejected.report, "online.jev").status).toBe("fail");
  });

  it("warns when Firecrawl credits are nearly gone", async () => {
    const net = fakeFetch({
      ...GOOD_ROUTES,
      "https://api.firecrawl.dev/v2/team/credit-usage": () =>
        reply(200, { success: true, data: { remainingCredits: 12 } }),
    });
    const { report } = await doctor(["--online"], { env, deps: { fetchImpl: net.fetchImpl } });
    expect(check(report, "online.firecrawl")).toMatchObject({
      status: "warn",
      summary: "12 credits left",
    });
  });

  it("fails when the Speechify voice id is not in the voice list and names some that are", async () => {
    const { code, report } = await doctor(["--online"], {
      env: { ...env, SPEECHIFY_VOICE_ID: "ghost_99" },
    });
    expect(code).toBe(1);
    const failed = check(report, "online.speechify");
    expect(failed.summary).toContain("ghost_99");
    expect(failed.hint).toContain("geffen_32");
  });

  it("reads the voice list from an object as well as an array", async () => {
    const net = fakeFetch({
      ...GOOD_ROUTES,
      "https://api.speechify.ai/v1/voices": () => reply(200, { voices: [{ id: "geffen_32" }] }),
    });
    const { report } = await doctor(["--online"], { env, deps: { fetchImpl: net.fetchImpl } });
    expect(check(report, "online.speechify").status).toBe("ok");
  });

  it("fails an unusable Blob token", async () => {
    const { report } = await doctor(["--online"], {
      env,
      deps: {
        createBlob: () => ({
          ...okBlob,
          list: async () => {
            throw new Error("Vercel Blob: Access denied, please provide a valid token");
          },
        }),
      },
    });
    expect(check(report, "online.blob").status).toBe("fail");
    expect(check(report, "online.blob").hint).toContain("secrets:push");
  });

  it("skips services whose key is unset, with a warning and no request", async () => {
    const net = fakeFetch();
    const { code, report } = await doctor(["--online"], {
      env: {},
      deps: { fetchImpl: net.fetchImpl },
    });
    expect(code).toBe(0);
    expect(net.calls).toEqual([]);
    for (const id of [
      "online.anthropic",
      "online.jev",
      "online.exa",
      "online.firecrawl",
      "online.speechify",
      "online.blob",
    ]) {
      expect(check(report, id)).toMatchObject({ status: "warn" });
      expect(check(report, id).summary).toContain("skipped");
    }
  });

  it("totals the checks in the JSON report", async () => {
    const { report } = await doctor(["--online"], { env });
    const counted = { ok: 0, warn: 0, fail: 0 };
    for (const c of report?.checks ?? []) counted[c.status] += 1;
    expect(report?.totals).toEqual(counted);
  });
});
