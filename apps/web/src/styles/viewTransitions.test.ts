import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The move into a briefing settles from the side only if its rule beats the rule for every move.
 * Both set `animation`, so the one for a single kind must weigh at least as much and come later.
 * For a while it weighed less (the general rule carried a :not()), and the settle never showed.
 */
/** Spacing is the formatter's business: a long selector may be laid out over several lines. */
const tight = (text: string) => text.replace(/\s+/g, "");
const CSS = tight(readFileSync(join(import.meta.dirname, "view-transitions.css"), "utf8"));

/** Selector specificity as [ids, classes and attributes and pseudo-classes, types and pseudo-elements]. */
function specificity(selector: string): [number, number, number] {
  // :is() and :not() weigh what their heaviest argument weighs; here every argument is one attribute.
  const flat = selector.replace(/:(is|not)\(([^)]*)\)/g, (_all, _name, list: string) => {
    const first = list.split(",")[0] ?? "";
    return first.trim();
  });
  const ids = (flat.match(/#[\w-]+/g) ?? []).length;
  const classes = (flat.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length;
  const types = (flat.match(/::[\w-]+|(?:^|[\s>+~])[a-z][\w-]*/g) ?? []).length;
  return [ids, classes, types];
}

function ruleStart(selector: string): number {
  const index = CSS.indexOf(`${tight(selector)}{`);
  if (index < 0) throw new Error(`no rule for ${selector}`);
  return index;
}

const KINDS = (attribute: string) =>
  `html:is([${attribute}="peer"], [${attribute}="in"], [${attribute}="out"])`;

describe("view transitions: which rule draws a move", () => {
  const pairs = [
    {
      name: "the page's own fade",
      general: `${KINDS("data-nav-swap")} .shell`,
      one: ['html[data-nav-swap="in"] .shell', 'html[data-nav-swap="out"] .shell'],
    },
    {
      name: "the view transition's picture of the new page",
      general: `${KINDS("data-astro-nav")}::view-transition-new(root)`,
      one: [
        'html[data-astro-nav="in"]::view-transition-new(root)',
        'html[data-astro-nav="out"]::view-transition-new(root)',
      ],
    },
  ];

  for (const { name, general, one } of pairs) {
    it(`${name}: the rule for one kind of move beats the rule for all of them`, () => {
      for (const selector of one) {
        expect(specificity(selector)).toEqual(specificity(general));
        expect(ruleStart(selector)).toBeGreaterThan(ruleStart(general));
      }
    });
  }

  it("no rule for a move is weighed up by :not()", () => {
    expect(CSS).not.toMatch(/html\[data-(astro-nav|nav-swap)[^\]]*\]:not\(/);
  });

  it("nothing fades out: the old page is gone when the new one arrives", () => {
    expect(CSS).not.toMatch(/fade-out/);
  });
});
