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
    "docs/README.md": "# Docs\n\n[state.md](state.md) [decisions](decisions/README.md)\n",
    "docs/state.md":
      "# State\n\n## Not working or unverified\n\n- The flick. closed when: it passes ten runs.\n",
    "docs/decisions/README.md":
      "# Decisions\n\n## Index\n\n| ID | Decision | Status |\n| D1 | One | active |\n| D2 | Two | active |\n",
    "docs/decisions/area.md": "# Area\n\n## D1: One\n\nBody.\n",
    "docs/decisions/area-two.md": "# Area two\n\n## D2: Two\n\nBody.\n",
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
        "docs/decisions/README.md":
          "## Index\n\n| D1 | One | superseded by D9 |\n| D2 | Two | active |\n",
        "docs/decisions/area.md": "## D1: One\n\nBody.\n",
        "docs/decisions/area-two.md": "# Area two\n",
        "docs/learnings.md": "See [the note](history/gone.md). Fixed in `scripts/moved.ts`.\n",
      }),
    );
    expect(fails).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^docs\/state\.md: \d+ bytes, budget 12000$/),
        expect.stringContaining('unverified item without "closed when:": The flick is flaky.'),
        "docs/decisions/README.md: Index row D2 has no entry",
        expect.stringContaining('"superseded by D9" names a decision that does not exist'),
        "docs/learnings.md: broken link history/gone.md",
        "docs/learnings.md: names a missing file scripts/moved.ts",
        "docs/README.md: does not list learnings.md",
      ]),
    );
  });

  // Bug: D136 "replaces D46, D58, D113, D130" while their rows still said active, so agents grepping
  // the Index status column built on dead decisions.
  it("fails a row that replaces a decision whose own row still says active", () => {
    const index = (old: string) =>
      `## Index\n\n| D1 | One | ${old} |\n| D2 | Two | active; replaces D1 |\n`;
    const entries = { "docs/decisions/area.md": "## D1: One\n\n## D2: Two\n" };
    const bad = checkDocs(repo({ "docs/decisions/README.md": index("active"), ...entries }));
    expect(bad.fails).toEqual([expect.stringContaining('D1\'s row is not "superseded by D2"')]);
    const good = checkDocs(
      repo({ "docs/decisions/README.md": index("superseded by D2"), ...entries }),
    );
    expect(good.fails).toEqual([]);
  });

  // Bug: the check read the whole old row, so "superseded by" in its description passed a row
  // whose status was still active; "D1, D2, and D3" skipped D3; a target that did not exist passed.
  it("reads the old row's status column, every id in an Oxford-comma list, and missing targets", () => {
    const entries = {
      "docs/decisions/area.md": "## D1: One\n\n## D2: Two\n\n## D3: Three\n\n## D4: Four\n",
    };
    const index = (rows: string) => `## Index\n\n${rows}\n`;
    const check = (rows: string) =>
      checkDocs(repo({ "docs/decisions/README.md": index(rows), ...entries })).fails;
    expect(
      check(
        "| D1 | One | active |\n| D2 | Two | active |\n| D3 | Three, part superseded by D2 | active |\n| D4 | Four | active; replaces D1, D2, and D3 |",
      ),
    ).toEqual([
      expect.stringContaining("D1's row"),
      expect.stringContaining("D2's row"),
      expect.stringContaining("D3's row"),
    ]);
    expect(
      check(
        "| D1 | One | active |\n| D2 | Two | active |\n| D3 | Three | active |\n| D4 | Four | active; replaces D9 |",
      ),
    ).toEqual([expect.stringContaining("D9, which does not exist")]);
  });
});
