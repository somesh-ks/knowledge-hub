import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tokenGroups, usageComment } from "./designCatalogue";

/** A repo root with one stylesheet and one tokens file, so the test reads no live file. */
function root(css: string, tokens: object): string {
  const dir = mkdtempSync(join(tmpdir(), "design-catalogue-"));
  mkdirSync(join(dir, "apps", "web", "src", "styles"), { recursive: true });
  mkdirSync(join(dir, "tokens"), { recursive: true });
  writeFileSync(join(dir, "apps", "web", "src", "styles", "x.css"), css);
  writeFileSync(join(dir, "tokens", "tokens.json"), JSON.stringify(tokens));
  return dir;
}

describe("the design catalogue's readers", () => {
  it("takes the comment over the class's own rule, not the group it opens elsewhere without one", () => {
    const dir = root(
      [
        ".btn,",
        ".icon-btn {",
        "  display: flex;",
        "}",
        "",
        "/* The icon button: one glyph in",
        "   a round target. */",
        ".icon-btn {",
        "  padding: 0;",
        "}",
        "",
        ".plain {",
        "}",
      ].join("\n"),
      {},
    );
    expect(usageComment("x.css", ".icon-btn", dir)).toBe(
      "The icon button: one glyph in a round target.",
    );
    expect(usageComment("x.css", ".plain", dir)).toBe("");
  });

  it("names each token as the build writes it and keeps a reference as written", () => {
    const dir = root("", {
      semantic: {
        color: {
          accent: {
            $type: "color",
            $value: "{primitive.color.blue-700}",
            $description: "The accent.",
          },
        },
        text: {
          title: {
            $type: "typography",
            $value: { size: "{primitive.font.size.title}", weight: 400 },
          },
        },
      },
    });
    const groups = tokenGroups("semantic", dir);
    expect(groups.get("color")).toEqual([
      {
        path: "color.accent",
        name: "--color-accent",
        type: "color",
        value: "{primitive.color.blue-700}",
        description: "The accent.",
      },
    ]);
    expect(groups.get("text")?.[0]?.value).toBe("size {primitive.font.size.title}, weight 400");
  });
});
