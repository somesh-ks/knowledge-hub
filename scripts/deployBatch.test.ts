import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// The batch skips a deploy on purpose, so a mistake in it fails silently: a fix that merged and
// never went live, or a deploy that still fires per merge. Each case is a push as Vercel sees it,
// run through the real script in a real repository.
const SCRIPT = join(import.meta.dirname, "deploy-batch.sh");
const roots: string[] = [];
const HOUR = 3_600_000;

function git(root: string, args: string[], when = Date.now()): string {
  const date = new Date(when).toISOString();
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  }).trim();
}

function repo() {
  const root = mkdtempSync(join(tmpdir(), "deploy-batch-"));
  roots.push(root);
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "scripts", "deploy-batch.sh"), "");
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "t@example.com"]);
  git(root, ["config", "user.name", "t"]);
  const commit = (file: string, message: string, when = Date.now()) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), `${message}${Math.random()}`);
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", message], when);
  };
  commit("apps/web/page.ts", "first");
  const deployed = git(root, ["rev-parse", "HEAD"]);
  // What Vercel runs: from the project's root, with the last deployed commit named.
  const push = (extra: Record<string, string> = {}) =>
    spawnSync("sh", [SCRIPT, "--", ".", "../../tokens"], {
      cwd: join(root, "apps/web"),
      env: {
        ...process.env,
        VERCEL_GIT_PREVIOUS_SHA: deployed,
        VERCEL_GIT_COMMIT_SHA: git(root, ["rev-parse", "HEAD"]),
        VERCEL_GIT_COMMIT_REF: "main",
        ...extra,
      },
    }).status;
  return { root, commit, push, deployed };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("deploy-batch.sh", () => {
  // A deploy per merge was ~36 builds a day; waiting must not become waiting forever.
  it("holds code merges until five have landed, and content pushes neither count nor build", () => {
    const { commit, push } = repo();
    for (let n = 1; n <= 4; n += 1) {
      commit(`apps/web/m${n}.ts`, `fix: merge ${n}`);
      commit("state/last-run.json", `chore(digest): ${n}`);
      expect(push(), `after merge ${n}`).toBe(0);
    }
    commit("apps/web/m5.ts", "fix: merge 5");
    expect(push()).toBe(1);
  });

  it("a content push alone never builds", () => {
    const { commit, push } = repo();
    commit("state/last-run.json", "chore(digest): 1");
    commit("Digests/2026-11-05.md", "chore(audio): add narration");
    expect(push()).toBe(0);
  });

  // The owner waits to try a fix on his phone: the marker ships it with whatever is pending.
  it("builds at once when a subject since the last deploy ends with [deploy], even a docs-only one", () => {
    const { commit, push } = repo();
    commit("apps/web/fix.ts", "fix: the player");
    expect(push()).toBe(0);
    // A commit that only talks about the marker is not a request.
    commit("docs/runbook.md", "docs: explain the [deploy] marker");
    expect(push()).toBe(0);
    // GitHub's squash adds the PR number after the title.
    commit("docs/state.md", "docs: deploy now [deploy] (#718)");
    expect(push()).toBe(1);
  });

  it("the marker with nothing to ship does not build", () => {
    const { commit, push } = repo();
    commit("docs/state.md", "docs: note [deploy]");
    expect(push()).toBe(0);
  });

  // A lone fix would otherwise sit until four more merges, a quiet weekend included.
  it("builds a merge that has waited three hours, and holds one that has not", () => {
    const fresh = repo();
    fresh.commit("apps/web/a.ts", "fix: fresh", Date.now() - 10 * 60_000);
    expect(fresh.push()).toBe(0);
    const old = repo();
    old.commit("apps/web/a.ts", "fix: old", Date.now() - 4 * HOUR);
    old.commit("state/last-run.json", "chore(digest): later");
    expect(old.push()).toBe(1);
  });

  // Each is a case where skipping would hide a deploy that must run.
  it("builds when it cannot tell, on a redeploy, and on a preview branch", () => {
    const { commit, push, deployed } = repo();
    commit("apps/web/a.ts", "fix: one");
    expect(push({ VERCEL_GIT_PREVIOUS_SHA: "" })).toBe(1);
    expect(push({ VERCEL_GIT_PREVIOUS_SHA: "0".repeat(40) })).toBe(1);
    expect(push({ VERCEL_GIT_COMMIT_SHA: deployed })).toBe(1);
    expect(push({ VERCEL_GIT_COMMIT_REF: "preview/tryout" })).toBe(1);
    expect(push()).toBe(0);
  });
});
