import { describe, expect, it } from "vitest";
import { movedPath, rewriteSource } from "./dsMigrate.mjs";

// A branch opened before the move runs the codemod once after it merges. Without this a rewrite that
// points an import at the wrong file, or a second run that rewrites an import again, breaks every
// open branch at once.
const LAYOUT = new Set([
  "packages/design-system/src/Button.astro",
  "packages/design-system/src/button.ts",
  "packages/design-system/src/Icon.astro",
  "packages/design-system/styles/sheet.css",
  "packages/design-system/styles/icon.css",
  "packages/design-system/fonts/pirata-one-latin-400-normal.woff2",
  "packages/design-system/tokens/system.json",
  "packages/design-system/scripts/buildTokens.ts",
  "apps/web/src/styles/player.css",
  "scripts/buildIcons.ts",
  "packages/design-system/scripts/colorMath.ts",
]);
const exists = (path: string) => LAYOUT.has(path);

describe("dsMigrate", () => {
  it("points an app's imports of the system at the package", () => {
    const page = [
      'import Button from "../design-system/Button.astro";',
      'import { buttonClass } from "../design-system/button";',
      'import "../styles/sheet.css";',
      'import "../styles/player.css";',
      'import raw from "../../../../tokens/system.json?raw";',
    ].join("\n");
    expect(rewriteSource(page, "apps/web/src/components/Card.astro", exists)).toBe(
      [
        'import Button from "@singularity/design-system/Button.astro";',
        'import { buttonClass } from "@singularity/design-system/button";',
        'import "@singularity/design-system/styles/sheet.css";',
        'import "../styles/player.css";',
        'import raw from "@singularity/design-system/tokens/system.json?raw";',
      ].join("\n"),
    );
    // A script names a moved .ts module by its .js output name.
    const script = 'import { loadTokens } from "./buildTokens.js";';
    expect(rewriteSource(script, "scripts/buildPrototype.ts", exists)).toBe(
      'import { loadTokens } from "@singularity/design-system/scripts/buildTokens";',
    );
  });

  it("keeps a moved file's imports relative, and repoints the ones that left with it", () => {
    const font = 'src: url("../assets/fonts/pirata-one-latin-400-normal.woff2") format("woff2");';
    expect(rewriteSource(font, movedPath("apps/web/src/styles/fonts.css"), exists)).toBe(
      'src: url("../fonts/pirata-one-latin-400-normal.woff2") format("woff2");',
    );
    const script = 'import { a } from "./buildIcons.js";\nimport { b } from "./buildTokens.js";';
    expect(rewriteSource(script, movedPath("scripts/styleRecipe.ts"), exists)).toBe(
      'import { a } from "../../../scripts/buildIcons.js";\nimport { b } from "./buildTokens.js";',
    );
    const icon = 'import "../styles/icon.css";';
    expect(rewriteSource(icon, movedPath("apps/web/src/design-system/Icon.astro"), exists)).toBe(
      icon,
    );
    // A file moved by an earlier run follows a module the map moves later (colorMath joined in step 4b).
    const earlier = 'import { a } from "../../../scripts/colorMath.js";';
    expect(rewriteSource(earlier, "packages/design-system/scripts/buildTokens.ts", exists)).toBe(
      'import { a } from "./colorMath.js";',
    );
  });

  it("changes nothing on a second run", () => {
    const page = 'import Button from "../design-system/Button.astro";';
    const once = rewriteSource(page, "apps/web/src/components/Card.astro", exists);
    expect(rewriteSource(once, "apps/web/src/components/Card.astro", exists)).toBe(once);
    const script = 'import { a } from "./buildIcons.js";';
    const file = movedPath("scripts/buildTokens.ts");
    const moved = rewriteSource(script, file, exists);
    expect(rewriteSource(moved, file, exists)).toBe(moved);
  });
});
