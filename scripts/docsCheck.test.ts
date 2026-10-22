import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkDocs } from "./docsCheck.mjs";

// The record drifts and nobody sees it: state grows into a log, an Index row loses its entry,
// an open item never closes, a link points at a moved file. Each fixture breaks one of these.
const roots: string[] = [];

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "docs-check-"));
  roots.push(root);
  const base = {
    "AGENTS.md": "# Agents\n\nRead [state](docs/state.md).\n",
    "docs/README.md": "# Docs\n\n[state.md](state.md) [decisions.md](decisions.md)\n",
    "docs/state.md":
      "# State\n\n## Not working or unverified\n\n- The flick. closed when: it passes ten runs.\n",
    "docs/decisions.md":
      "# Decisions\n\n## Index\n\n| ID | Decision | Status |\n| D1 | One | active |\n\n## D1: One\n\nBody.\n",
  };
  for (const [rel, text] of Object.entries({ ...base, ...files })) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("docs check", () => {
  it("passes a record that holds its rules", () => {
    expect(checkDocs(repo({})).fails).toEqual([]);
  });

  it("fails each kind of drift with its own line", () => {
    const { fails } = checkDocs(
      repo({
        "docs/state.md": `# State\n\n${"x".repeat(12_001)}\n\n## Not working or unverified\n\n- The flick is flaky.\n`,
        "docs/decisions.md":
          "## Index\n\n| D1 | One | superseded by D9 |\n| D2 | Two | active |\n\n## D1: One\n\nsuperseded by D9\n",
        "docs/learnings.md": "See [the note](history/gone.md). Fixed in `scripts/moved.ts`.\n",
      }),
    );
    expect(fails).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^docs\/state\.md: \d+ bytes, budget 12000$/),
        expect.stringContaining('unverified item without "closed when:": The flick is flaky.'),
        "docs/decisions.md: Index row D2 has no entry",
        expect.stringContaining('"superseded by D9" names a decision that does not exist'),
        "docs/learnings.md: broken link history/gone.md",
        "docs/learnings.md: names a missing file scripts/moved.ts",
        "docs/README.md: does not list learnings.md",
      ]),
    );
  });
});
