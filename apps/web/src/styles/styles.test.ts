import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { COMPONENTS } from "../design-system/registry";

/**
 * House rules for the shell's own CSS, checked on the files it owns. tokens.css and foundations.css
 * belong to the design system and have their own tests (scripts/buildTokens.test.ts). Biome holds
 * the rules it can lint (`noImportantStyles` is an error in biome.json).
 */

const STYLES = import.meta.dirname;
const SRC = join(STYLES, "..");
const OWN_FILES = readdirSync(STYLES).filter(
  (file) => file.endsWith(".css") && !["tokens.css", "foundations.css"].includes(file),
);
const read = (file: string) => readFileSync(join(STYLES, file), "utf8");

/** Comments and the generated-font header carry prose and commands, not styles. */
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Every own stylesheet without its comments, as [file, css]. */
const ownCss = () => OWN_FILES.map((file) => [file, withoutComments(read(file))] as const);

/** Source files under a directory (e2e excluded) with one of the extensions. */
function filesUnder(dir: string, extensions: string[]): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "e2e" ? [] : filesUnder(path, extensions);
    return extensions.some((extension) => path.endsWith(extension)) ? [path] : [];
  });
}

/**
 * The classes of controls whose face is words: a label on a track, a navigation item, the wordmark,
 * a text action, a card with a title. A press shows on their fill, their colour or an icon.
 */
const LABEL_CONTROLS = [
  "button-text",
  "button-filled",
  "button-tonal",
  "source-main",
  "segmented-choice-item",
  "segmented-nav-tab",
  "filter-chip",
  "chip",
  "app-nav-item",
  "app-nav-create",
  "wordmark",
  "toast-action",
  "card-link",
  "create-fab",
  "play-fab",
  "source-link",
  "menu-item",
  "story-row",
  "player-upnext-row",
  "script-back",
];

/**
 * The only rules that may space with --space-1 (4px), each with why. Everything else spaces on the
 * 8pt grid: a 4px gap between two rows, or under a heading, reads as the two touching. A selector
 * matches when it contains the entry as a whole name.
 */
const ALLOWED_4PX: [selector: string, reason: string][] = [
  [".aside", "the rail's hit area reaching past the column's edge"],
  [".aside-rail", "the rail's track padding, around its own segments"],
  [".banner-notice > .button-text", "the action's hit area reaching into the banner's padding"],
  [".banner-body", "a banner's title onto its body, inside one banner"],
  [".menu-tile", "a glyph onto its word inside one tile: the icon-to-label gap is 4px, items 8px"],
  [
    ".menu-tiles[data-fold] > .menu-item",
    "the Library card's quick actions are the same tiles on a phone: glyph to word 4px",
  ],
  [".story", "an optical nudge: the row's bottom half-gap less the chips' hit-area overhang"],
  [".queue-going", "a ring onto its time or percent inside one lead: the icon-to-label gap is 4px"],
  [".create-fab-label", "the button's own inner gap at the label's end"],
  [".sheet-head", "the header's 44px buttons, offset to the edge as a hit area"],
  [".create-more-text", "title onto its subtitle inside one row"],
  [".episode-highlight-actions", "the chips' hit-area overhang under the highlight"],
  [".hero-text", "title onto its subtitle inside one block"],
  [
    ".hero-actions",
    "room for the row's focus rings inside its scroller, taken back by its margins",
  ],
  [".library-filters", "room for the chips' focus ring inside the scroller"],
  [".filter-chips-scroll", "room for the chips' focus ring inside the scroller"],
  ['[data-view="list"] .card-link::after', "the row's press layer, inset as a hit area"],
  [".card-match", "title onto its subtitle inside one row"],
  [".card-sub", "title onto its subtitle inside one row"],
  [".multiselect-text", "title onto its subtitle inside one option"],
  [".player-collapse", "the button's inner padding and its offset past the focus ring"],
  [".player-meta", "the title onto its meta line"],
  [".player-meta-line", "an icon beside its own label, and the notice's inner padding"],
  [".player-title", "room for the title's focus ring"],
  [".dock-text", "title onto its subtitle inside one row"],
  [".dock-seek-time", "a chip's inner padding"],
  [".scrubber-bubble", "a chip's inner padding and its optical nudge onto the track"],
  [".script-turn", "the speaker onto their words inside one turn"],
  [".row-action::after", "the row's press layer, inset as a hit area"],
  [".source-link", "an icon beside its own label"],
  [".filter-chip", "a chip's inner gap"],
  [".select-tonal > select::picker(select)", "the list's edge onto the label's outline"],
  [".meta-wrap", "the meta link's hit area reaching past its words"],
  [".segmented-choice-item", "the check glyph beside its own segment label"],
  [".segmented-nav", "a segmented track: the pill inset by its 4px track padding"],
  [".settings-text", "title onto its subtitle inside one row"],
  [
    ".costs-answer",
    "a figure's label onto the figure, and the figure onto its line, inside one block",
  ],
  [".toast", "the action's hit area reaching the toast's edge"],
  [".app-bar-back", "the back button's hit area, offset to the edge"],
  [".app-nav-item", "an icon beside its own label"],
  [".source-icon > img", "the favicon's inset inside its own tile"],
  [".source-host", "the separator dot beside its own text"],
  [".score", "the meter beside its own label"],
  [".source-card-score", "the meter beside its own label"],
  [".source-plus-btn", "the button's hit area and its press layer's inset"],
  ["html[data-manage-toast-open]", "a bar's inset sum: the 4px inset doubled, landing on the grid"],
];

/** Hand-written source (markup and script) the design rules read: no tests, fixtures or test kits. */
const sourceFiles = () =>
  filesUnder(SRC, [".astro", ".tsx", ".ts"]).filter(
    (file) => !/\.(?:test|spec)\.tsx?$|[\\/](?:fixtures|testing)[\\/]|testing\.ts$/.test(file),
  );

const posix = (file: string) => relative(SRC, file).replaceAll("\\", "/");

/** Source files that may hold a colour literal, each with why it is not a painted design colour. */
const RAW_COLOR_ALLOWED: [file: string, reason: string][] = [
  ["scripts/ambientTint.ts", "#808080 is the neutral fallback of the cover-sampling maths"],
  ["scripts/ambientPalette.ts", "#808080 is the neutral fallback of the cover-sampling maths"],
  ["player/core/chapterMask.ts", "#000 is a CSS mask: only its alpha matters, it paints nothing"],
];

/** Easings defined outside tokens.css, as "file name". */
const LOCAL_EASES: [file: string, reason: string][] = [
  ["player.css --ease-in-out-sine", "the cover glow's breathing sine curve; no token is a sine"],
  ["empty.css --ease-in-out-sine", "the same sine curve for the Halloween scenes' breathing loops"],
];

/** Files that may hold an inline <svg>: the Icon components, the mark, the art and named one-offs. */
const RAW_SVG_ALLOWED: [file: string, reason: string][] = [
  ["design-system/Icon.astro", "the Icon component"],
  ["player/ui/Icon.tsx", "the island Icon component"],
  ["player/ui/LazyIcon.tsx", "the lazy island Icon component"],
  ["components/BrandMark.astro", "the wordmark's own mark, not a glyph"],
  ["components/EmptyArt.astro", "empty-state illustrations, coloured by classes (own rule above)"],
  [
    "components/EmptyArtHalloween.astro",
    "a style's own empty-state scenes (D306), coloured by classes (own rule above)",
  ],
  [
    "components/Cobweb.astro",
    "a style's corner ornament (D306), coloured by classes (own rule above)",
  ],
  [
    "components/QueueRing.astro",
    "the progress ring of the podcast queue: a drawn arc, coloured by classes, not a glyph",
  ],
  [
    "sheets/GenerateSheet.tsx",
    "a glyph-set path that needs the shared .icon class the island Icon lacks",
  ],
];

/** The widths a media query may name, in rem: --breakpoint-wide, -side and -aside (tokens.css), the
 * narrowest phone (22.5rem, where a four-way control loses its labels) and the widest player page
 * (100rem). */
const BREAKPOINTS = ["22.5", "40", "64", "80", "100"];

const SHARED_CONTROL_SHEETS = ["buttons.css", "primitives.css"];

/** The shared control classes, defined in buttons.css and primitives.css. */
const SHARED_CONTROLS = [
  "button-text",
  "button-filled",
  "button-tonal",
  "icon-btn",
  "icon-btn-tonal",
  "chip",
  "filter-chip",
  "tab",
  "segmented-choice-item",
  "segmented-nav-tab",
];

/** Controls styled in their own sheet or built bespoke, each with why they are not a shared one. A new
 * entry needs the design-system label (scripts/designSystemGate.mjs): any other PR may only shrink it. */
const BESPOKE_CONTROLS: [name: string, reason: string][] = [
  [
    "create-fab",
    "the extended floating create button (D133); its own size, label and sheet origin",
  ],
  ["play-fab", "the floating play button of a story, a circle over a cover"],
  ["add-fab", "the Topics floating add button"],
  ["view-btn", "the Library's gallery/list switch: two icon segments"],
  ["dock-btn", "the player dock's icon buttons, sized to the dock"],
  ["dock-open", "the dock's whole-bar button that opens the player"],
  ["transport-btn", "the player transport: play, skip and seek on the player's own scale"],
  ["transport-skip", "the player transport's skip variant"],
  ["source-plus-btn", "the sources list's inline add control"],
  ["source-edit", "a text action on a source row"],
  ["source-remove", "a text action on a source row"],
  ["cover-play", "the cover's play overlay"],
  ["menu-item", "a row of the popover menu"],
  ["menu-item-danger", "the menu's destructive row"],
  ["topic-delete", "the topic page's destructive menu row"],
  ["toast-action", "a toast's text action"],
  ["toast-dismiss", "a toast's close control"],
  ["multiselect-trigger", "the multi-select's field-like trigger"],
  ["picker-trigger", "the search picker's field-like trigger, drawn by scripts/picker.ts"],
  ["profile-shape", "a shape choice in the profile's avatar picker: the avatar is its face (D335)"],
  ["emoji-cell", "a cell of the topic emoji grid: a square tile, not a pill (D186)"],
  ["search-clear", "the clear control inside .search-field"],
  [
    "queue-fold",
    "the podcast queue dock's whole-row button that folds and opens it: a row, not a control face",
  ],
  [
    "app-nav-queue",
    "the side column's queue row: the navigation row's own look (app-nav-item) on a button",
  ],
  ["player-queue-row", "a queue row: a row-sized button, not a control face"],
  ["player-upnext-row", "an Up next row: a row-sized button, not a control face"],
  ["story-row", "a story row in the player's list"],
  ["script-back", "the transcript's back-to-playing control"],
  ["script-turn", "a transcript turn that seeks on tap"],
];

/** The field family, whose outline is its form (D54): the Field and Select components, and the
 * field-like triggers of the multi-select and the search picker. */
const FIELDS = [
  ...COMPONENTS.filter(({ name }) => ["Field", "Select"].includes(name)).flatMap(
    ({ classes }) => classes,
  ),
  "multiselect-trigger",
  "picker-trigger",
];

/**
 * The control rules that still draw an outline, as "file: selector", each with why. Outlines are for
 * text fields (D54, D72), so each is the owner's call to keep or make tonal, and the list only shrinks:
 * a new entry needs the design-system label (scripts/designSystemGate.mjs).
 */
const OUTLINED_CONTROLS: [rule: string, reason: string][] = [
  [
    'profile.css: .profile-shape[aria-pressed="true"]',
    "the chosen shape in the profile's avatar picker, ringed in the accent (D335)",
  ],
  [
    'topics.css: .emoji-cell[aria-current="true"]',
    "the topic's own emoji in the emoji grid: a hairline ring on its tonal cell",
  ],
];

/**
 * Every button a source file draws, with the class text it is given: a <button> tag's class
 * attribute, the class a helper takes with the tag (`element("button", "picker-trigger")`), or what a
 * script sets on a `createElement("button")`. Until 2026-11-04 the rules read only .astro and .tsx,
 * so a script's buttons escaped them. `undefined` is a class the file computes where no rule can read
 * it (`class={...}`, `class:list`, a template string's `${name}` alone).
 */
function buttonsIn(text: string): { tag: string; classes: string | undefined }[] {
  const tags = [...text.matchAll(/<button\b[^>]*>/g)].map(([tag]) => {
    const value = /class(?:Name)?="([^"]*)"/.exec(tag)?.[1] ?? "";
    const computed =
      /class(?:Name)?=\{|class:list/.test(tag) || /^\s*\$\{\s*\w+\s*\}\s*$/.test(value);
    return { tag, classes: computed ? undefined : value };
  });
  const helpers = [
    ...text.matchAll(/\w+\(\s*(["'])button\1\s*,\s*(["'`])((?:\\.|(?!\2)[^\\])*)\2/g),
  ].map(([tag, , , classes]) => ({ tag, classes }));
  const built = [
    ...text.matchAll(/(\w+)\s*=\s*(?:document\.)?createElement\(\s*(["'])button\2\s*\)/g),
  ].map(([tag, name]) => ({
    tag,
    classes: [
      ...text.matchAll(
        new RegExp(
          `\\b${name}\\.(?:className\\s*=(?!=)|classList\\.add\\(|setAttribute\\(\\s*["']class["']\\s*,)([^;]*)`,
          "g",
        ),
      ),
    ]
      .map(([, set]) => set)
      .join(" "),
  }));
  return [...tags, ...helpers, ...built];
}

/** The class names in a button's class text, without the code of a template string's `${...}`. */
const classWords = (classes: string) =>
  classes.replace(/\$\{[^}]*\}/g, " ").match(/[a-z][\w-]*/g) ?? [];

/** Whether a button's classes are the system's: a shared or named bespoke class, or a class helper's. */
const systemButton = (classes: string) =>
  /\b\w+Class\(/.test(classes) ||
  classWords(classes).some(
    (name) => SHARED_CONTROLS.includes(name) || BESPOKE_CONTROLS.some(([al]) => al === name),
  );

/** Every class a button wears in the source, with the classes a page hands a <Button> to draw on it. */
const wornByButtons = () =>
  sourceFiles().flatMap((file) => {
    const text = readFileSync(file, "utf8");
    return [
      ...buttonsIn(text).map(({ classes }) => classes ?? ""),
      ...[...text.matchAll(/<Button\b[^>]*>/g)].map(
        ([tag]) => /\bclass(?:Name)?="([^"]*)"/.exec(tag)?.[1] ?? "",
      ),
    ].flatMap(classWords);
  });

/** A selector fragment as a whole name: `.aside` matches `.aside:hover`, not `.aside-x`. */
const wholeName = (fragment: string) =>
  new RegExp(`${fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`);

/** Every innermost rule of a stylesheet, as [selector, body]. */
const rulesOf = (css: string) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
    ([, selector = "", body = ""]) => [selector.trim(), body] as const,
  );

/** A selector list's selectors, split at its own commas, not at those inside :is() or :not(). */
function selectorsOf(list: string): string[] {
  const parts = [""];
  let depth = 0;
  for (const character of list) {
    depth += character === "(" ? 1 : character === ")" ? -1 : 0;
    if (character === "," && depth === 0) parts.push("");
    else parts[parts.length - 1] += character;
  }
  return parts;
}

/**
 * The root class of a top-level view. Its inline edges come from the page gutter (`.page`,
 * foundations.css) and the shell (shell.css), so no stylesheet gives a view root its own gutter or
 * width: a page that did sat 24px further in than Latest and Library (2026-10-26).
 */
const VIEW_ROOTS = ["settings-view", "library", "manage", "create-page", "design-page"];
const VIEW_EDGE =
  /^(?:padding|margin)(?:-(?:inline|left|right)(?:-(?:start|end))?)?$|^max-(?:width|inline-size)$/;

/** The declarations of a rule body, as [property, value]. */
const declarationsOf = (body: string) =>
  [...body.matchAll(/(?:^|;)\s*([a-z-]+)\s*:\s*([^;]+)/g)].map(
    ([, property = "", value = ""]) => [property, value.trim()] as const,
  );

/** A custom property's value in tokens.css, followed through var() to its end. */
function tokenValue(name: string): string {
  const tokens = read("tokens.css");
  let value = name;
  for (let hop = 0; hop < 8; hop += 1) {
    const reference = /^var\((--[\w-]+)\)$/.exec(value.trim());
    if (!reference) return value;
    value = new RegExp(`${reference[1]}:\\s*([^;]+);`).exec(tokens)?.[1] ?? value;
  }
  return value;
}

/** One house rule: its name and every place that breaks it. */
interface Rule {
  name: string;
  offenders: () => string[];
}

const RULES: Rule[] = [
  {
    name: "no element can show the browser's tap flash (a long press on a list row flashed blue)",
    offenders: () => {
      const foundations = withoutComments(read("foundations.css"));
      const global = /:where\(\*\)\s*\{[^}]*-webkit-tap-highlight-color:\s*transparent/.test(
        foundations,
      );
      const colours = [["foundations.css", foundations] as const, ...ownCss()].flatMap(
        ([file, css]) =>
          [...css.matchAll(/-webkit-tap-highlight-color:\s*([^;}]+)/g)]
            .filter((match) => match[1]?.trim() !== "transparent")
            .map((match) => `${file}: -webkit-tap-highlight-color: ${match[1]?.trim()}`),
      );
      return [
        ...(global ? [] : ["foundations.css has no :where(*) tap-highlight rule"]),
        ...colours,
      ];
    },
  },
  {
    name: "uses tokens for color, never a raw value",
    offenders: () =>
      ownCss().flatMap(([file, css]) => {
        // `color-mix(in oklch, var(--x) 8%, ...)` mixes tokens; the ban is on literal color functions.
        // `oklch(from var(--x) ...)` derives a color from a token, which is not a raw value either.
        const stripped = css
          .replace(/color-mix\(in [a-z]+/g, "color-mix(")
          .replace(/oklch\(from (?:var\(|red )/g, "derive(");
        const match =
          /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(/.exec(
            stripped,
          );
        return match ? [`${file}: ${match[0]}`] : [];
      }),
  },
  {
    name: "the empty-state art holds no raw colour: every fill and stroke comes from a class",
    offenders: () =>
      [
        "EmptyArt.astro",
        "EmptyArtHalloween.astro",
        "Cobweb.astro",
        "halloweenArt.ts",
        "cobweb.ts",
      ].flatMap((file) => {
        const art = readFileSync(join(SRC, "components", file), "utf8");
        const match = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|style=|\bfill="|\bstroke="/.exec(
          art,
        );
        return match ? [`${file}: ${match[0]}`] : [];
      }),
  },
  {
    // Prevents a part a style cannot reach: a style redraws the semantic tiers (the `--shape-*` corners
    // and the `--color-*` roles), so a component that reads a primitive radius or a colour ramp step
    // stays as Default draws it when Expressive or Halloween is on (the first Expressive missed the cards,
    // the menus, the sheets and the toast this way). Only the fully round pill is a primitive read.
    name: "reads the shape scale and the colour roles, never a primitive radius or a ramp colour",
    offenders: () =>
      ownCss().flatMap(([file, css]) =>
        [
          ...css.matchAll(
            /var\(\s*--(?:radius-(?:xs|sm|md|lg|xl|2xl|sheet)|color-(?:white|(?:grey|blue|green|orange|red|violet)-\d+))\s*[,)]/g,
          ),
        ].map(([read]) => `${file}: ${read}`),
      ),
  },
  {
    name: "takes spacing, type and radius from tokens, never a raw length",
    offenders: () => {
      // Space, type size, leading, tracking and corner radius each have a scale in tokens.css. A
      // literal length here is a value off that scale. Widths and heights are a component's own
      // dimensions and are not held to it.
      const scaled =
        /^(?:margin|padding|gap|row-gap|column-gap|inset|top|right|bottom|left|scroll-margin|scroll-padding|font-size|line-height|letter-spacing|border-radius|border-(?:start|end)-(?:start|end)-radius)(?:-[a-z-]+)?$/;
      const rawLength = /(?<![\w.-])-?\d*\.?\d+(?:px|rem|em)\b/;
      return ownCss().flatMap(([file, css]) =>
        [...css.matchAll(/^\s*([a-z-]+)\s*:\s*([^;{}]+);/gm)].flatMap(
          ([, property = "", value = ""]) => {
            if (!scaled.test(property)) return [];
            // What a var() falls back to is not this file's choice of value.
            const own = value.replace(/var\([^()]*(?:\([^()]*\)[^()]*)*\)/g, "token");
            return rawLength.test(own) ? [`${file}: ${property}: ${value.trim()}`] : [];
          },
        ),
      );
    },
  },
  {
    // A 12px gap beside a 16px one, or a 4px one between two rows, reads as rows touching and
    // headings crowding their controls. Space is 8, 16, 24 and up; 4px only where ALLOWED_4PX says.
    name: "spacing is on the 8pt grid",
    offenders: () => {
      const spacing =
        /^(?:margin|padding|gap|row-gap|column-gap|inset|top|right|bottom|left|scroll-margin|scroll-padding)(?:-[a-z-]+)?$/;
      return [
        ...ownCss(),
        ["foundations.css", withoutComments(read("foundations.css"))] as const,
      ].flatMap(([file, css]) =>
        rulesOf(css).flatMap(([selector, body]) =>
          declarationsOf(body)
            .filter(([property]) => spacing.test(property))
            .flatMap(([property, value]) =>
              [...value.matchAll(/--space-([\w]+)/g)]
                .filter(([, step]) => {
                  if (["2", "4", "6", "8", "12", "16", "24"].includes(step ?? "")) return false;
                  const fine = ALLOWED_4PX.some(([allowed]) => wholeName(allowed).test(selector));
                  return !(step === "1" && fine);
                })
                .map(([token]) => `${file}: ${selector} { ${property}: ${token} }`),
            ),
        ),
      );
    },
  },
  {
    // Headings are regular weight: the type's size and the space around it carry the hierarchy.
    // A medium heading reads as a button label and competes with the controls under it.
    name: "headings are never bold",
    offenders: () => {
      const heading = /(?:^|[\s>+~(,])h[1-6]\b|\.[\w-]+-(?:title|head|heading)\b|\.section-head\b/;
      const bold = (value: string) => {
        const end = tokenValue(value);
        return /medium|semibold|bold|^[5-9]00$/.test(end) || /medium|semibold|bold/.test(value);
      };
      return ownCss().flatMap(([file, css]) =>
        rulesOf(css).flatMap(([selector, body]) => {
          // The subject of each selector in the list: what follows its last combinator.
          const subjects = selector.split(",").map(
            (part) =>
              part
                .trim()
                .split(/\s+|>|\+|~/)
                .pop() ?? "",
          );
          if (!subjects.some((subject) => heading.test(subject.replace(/:[\w-]+\(.*$/, ""))))
            return [];
          return declarationsOf(body)
            .filter(([property, value]) => property === "font-weight" && bold(value))
            .map(([, value]) => `${file}: ${selector} { font-weight: ${value} }`);
        }),
      );
    },
  },
  {
    name: "uses only system colors that forced-colors mode defines",
    offenders: () => {
      // HighlightText only ever on a Highlight fill, its pair; ButtonBorder for a control's edge.
      const allowed = new Set([
        "GrayText",
        "Highlight",
        "HighlightText",
        "CanvasText",
        "ButtonText",
        "ButtonBorder",
      ]);
      return ownCss().flatMap(([file, css]) =>
        [
          ...css.matchAll(
            // Every system colour keyword, the deprecated ones too, matched whole: `\bHighlight\b`
            // alone let HighlightText through unchecked (2026-10-22).
            /\b(AccentColor|AccentColorText|ActiveText|ButtonBorder|ButtonFace|ButtonText|Canvas|CanvasText|Field|FieldText|GrayText|Highlight|HighlightText|LinkText|Mark|MarkText|SelectedItem|SelectedItemText|VisitedText|ActiveBorder|ActiveCaption|AppWorkspace|Background|ButtonHighlight|ButtonShadow|CaptionText|InactiveBorder|InactiveCaption|InactiveCaptionText|InfoBackground|InfoText|Menu|MenuText|Scrollbar|ThreeDDarkShadow|ThreeDFace|ThreeDHighlight|ThreeDLightShadow|ThreeDShadow|Window|WindowFrame|WindowText)\b/g,
          ),
        ]
          .filter((match) => !allowed.has(match[1] ?? ""))
          .map((match) => `${file}: ${match[1]}`),
      );
    },
  },
  {
    // A control that shrinks while pressed can slip out from under the pointer at its edge: the
    // cursor flickers and the press is dropped. The press scale stays close to 1.
    name: "keeps a pressable control the same size under the pointer",
    offenders: () => {
      const tokens = read("tokens.css");
      return ["--scale-press", "--scale-press-subtle"].filter((name) => {
        const value = Number(new RegExp(`${name}:\\s*([0-9.]+)`).exec(tokens)?.[1]);
        return !(value >= 0.94 && value <= 1);
      });
    },
  },
  {
    name: "never transitions all properties",
    offenders: () =>
      ownCss()
        .filter(([, css]) => /transition(?:-property)?\s*:\s*all\b/.test(css))
        .map(([file]) => file),
  },
  {
    // A bare `0s` is not a timing choice: it flips `visibility` at the end of a transform transition.
    name: "reads durations and curves from tokens",
    offenders: () => {
      const literal =
        /transition[^;{]*\b(?!0m?s\b)\d+(?:\.\d+)?m?s\b|animation(?:-duration)?\s*:[^;{]*\b(?!0m?s\b)\d+(?:\.\d+)?m?s\b/;
      return ownCss().flatMap(([file, css]) => {
        const match = literal.exec(css);
        return match ? [`${file}: ${match[0]}`] : [];
      });
    },
  },
  {
    // Every :hover rule sits inside a (hover: hover) block.
    name: "gates hover to fine pointers",
    offenders: () =>
      ownCss().flatMap(([file, css]) =>
        [...css.matchAll(/:hover/g)].flatMap((hover) => {
          const before = css.slice(0, hover.index);
          const lastGate = before.lastIndexOf("@media (hover: hover)");
          const lastClose = before.lastIndexOf("\n}\n");
          return lastGate === -1 || lastGate < lastClose
            ? [`${file}: a :hover rule outside @media (hover: hover) at ${hover.index}`]
            : [];
        }),
      ),
  },
  {
    name: "takes layer elevation from tokens, never a raw integer z-index",
    offenders: () =>
      ownCss()
        .filter(([, css]) => /^\s*z-index\s*:\s*-?\d+\s*;/m.test(css))
        .map(([file]) => file),
  },
  {
    // Two weights, regular and medium.
    name: "uses no third weight",
    offenders: () =>
      ownCss()
        .filter(([, css]) => /--font-weight-(?:semibold|bold)|font-weight:\s*[6-9]00/.test(css))
        .map(([file]) => file),
  },
  {
    // A state layer is 8% on hover and 12% on press, from the tokens, never a share of its own.
    name: "mixes state layers from the state tokens",
    offenders: () =>
      ["player.css", "sheets.css"].flatMap((file) =>
        [
          ...withoutComments(read(file)).matchAll(
            /^\s*background(?:-color)?\s*:[^;{}]*color-mix\([^;{}]*;/gm,
          ),
        ]
          .filter(([declaration = ""]) => /\d%/.test(declaration))
          .map(([declaration]) => `${file}: ${declaration.trim()}`),
      ),
  },
  {
    // Words never change size on a press. Scaling an element makes its text smaller for a moment
    // and draws its weight differently while it is scaled, which reads as a glitch. Controls whose
    // face is a label on a track (segments, chips, tabs) show a press on the thumb or the colour.
    name: "has no scale transform on the pressed state of a label control",
    offenders: () =>
      filesUnder(STYLES, [".css"]).flatMap((file) =>
        [...readFileSync(file, "utf8").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
          .filter(([, selector = "", body = ""]) => {
            if (!selector.includes(":active") || !/transform:\s*scale\(/.test(body)) return false;
            return LABEL_CONTROLS.some((name) => selector.includes(`.${name}`));
          })
          .map(([, selector = ""]) => `${file}: ${selector.trim()}`),
      ),
  },
  {
    // The same two breakpoints were spelled five ways (min-width, max-width: 63.9375rem, "not all
    // and", width <, range syntax; the design-system audit, 2026-10-25), so a search for a breakpoint
    // missed rules that use it. One spelling, range syntax, at the widths the breakpoint tokens name.
    name: "writes a width media query in range syntax at a breakpoint's width",
    offenders: () =>
      ownCss().flatMap(([file, css]) =>
        [...css.matchAll(/@media\s+([^{]+)\{/g)].flatMap(([, query = ""]) => {
          const q = query.replace(/\s+/g, " ").trim();
          if (/\b(?:min|max)-width\b|not all and/.test(q)) return [`${file}: @media ${q}`];
          const widths = [
            ...q.matchAll(/([\d.]+)rem\s*<=?\s*width|width\s*[<>]=?\s*([\d.]+)rem/g),
          ].map(([, low, high]) => low ?? high ?? "");
          return widths.every((width) => BREAKPOINTS.includes(width))
            ? []
            : [`${file}: @media ${q}`];
        }),
      ),
  },
  {
    // A style attribute is out of reach of every rule above: a raw padding or colour there would
    // ship unnoticed. Markup may only hand values to the stylesheet through custom properties.
    name: "no inline styling bypasses the tokens",
    offenders: () =>
      filesUnder(SRC, [".astro", ".tsx"]).flatMap((file) => {
        const markup = readFileSync(file, "utf8");
        return [...markup.matchAll(/\bstyle=(["{])/g)].flatMap((match) => {
          const start = (match.index ?? 0) + match[0].length;
          let end = start;
          if (match[1] === '"') end = markup.indexOf('"', start);
          else
            for (let depth = 1; depth > 0 && end < markup.length; end += 1)
              depth += markup[end] === "{" ? 1 : markup[end] === "}" ? -1 : 0;
          let expression = markup.slice(start, end);
          // style={name}: the object or string the file builds for it.
          const named = /^\s*(\w+)\s*\}?$/.exec(expression);
          if (named)
            expression =
              new RegExp(`const ${named[1]}\\s*=([^;]+);`).exec(markup)?.[1] ?? expression;
          const properties = [
            ...expression.matchAll(/(?:^|[{;,`"'\s])["']?(-{0,2}[a-zA-Z][\w-]*)["']?\s*:(?!:)/g),
          ]
            .map(([, name = ""]) => name)
            .filter((name) => !["as", "React"].includes(name));
          const own = properties.filter((name) => !name.startsWith("--"));
          return own.length > 0 || properties.length === 0
            ? [`${file}: style=${expression.trim().slice(0, 60)}`]
            : [];
        });
      }),
  },
  {
    name: "does not give a label control the press classes, which scale it",
    offenders: () =>
      filesUnder(SRC, [".astro", ".tsx"]).flatMap((file) => {
        const markup = readFileSync(file, "utf8");
        // A class attribute, or the string literals inside a class:list={[...]} array.
        const lists = [...markup.matchAll(/class:list=\{\[([^\]]*)\]\}/g)].flatMap((match) =>
          [...(match[1] ?? "").matchAll(/(["'`])((?:(?!\1).)*)\1/g)].map((literal) => literal[2]),
        );
        const attributes = [...markup.matchAll(/class(?:Name)?="([^"]*)"/g)].map(
          (match) => match[1],
        );
        return [...attributes, ...lists]
          .filter((value) => {
            const classes = (value ?? "").split(/\s+/);
            const label = classes.some((name) => LABEL_CONTROLS.includes(name));
            const press = classes.some((name) => name === "press" || name === "press-subtle");
            return label && press;
          })
          .map((value) => `${file}: ${value}`);
      }),
  },
  {
    // Two segmented controls that read differently (2026-10-20): a choice is a radiogroup with a
    // check, navigation is a tablist with a sliding pill. Swapping them breaks the keys, the roles
    // and what the owner sees.
    name: "a segmented radiogroup is the choice control, a segmented tablist the navigation one",
    offenders: () =>
      filesUnder(SRC, [".astro", ".tsx"]).flatMap((file) =>
        [...readFileSync(file, "utf8").matchAll(/<[a-z]+\s[^<>]*>/g)].flatMap(([tag]) => {
          const classes = /\bclass="([^"]*)"/.exec(tag)?.[1]?.split(/\s+/) ?? [];
          const role = /\brole="([^"]*)"/.exec(tag)?.[1];
          const choice = classes.includes("segmented-choice");
          const nav = classes.includes("segmented-nav");
          const wrong =
            (choice && role !== "radiogroup") ||
            (nav && role !== "tablist") ||
            (role === "radiogroup" && nav) ||
            (role === "tablist" && choice);
          return wrong ? [`${file}: ${tag.replace(/\s+/g, " ").slice(0, 80)}`] : [];
        }),
      ),
  },
  {
    // Prevents the 2026-10-21 drift: Sources and the topic page each drew an outlined search box and
    // their own outlined format chips while the Library had the pill and the tonal chip. One field
    // and one chip: a new page that needs search or filters wears the Library's.
    name: "a search input sits in the shared .search-field, a filter chip is the shared .filter-chip",
    offenders: () => [
      ...filesUnder(SRC, [".astro", ".tsx"]).flatMap((file) => {
        const markup = readFileSync(file, "utf8");
        const search = /type="search"|type=\{?["']search["']/.test(markup);
        return search && !/class(?:Name)?="[^"]*\bsearch-field\b/.test(markup)
          ? [`${file}: a search input outside .search-field`]
          : [];
      }),
      ...filesUnder(SRC, [".astro", ".tsx", ".ts"]).flatMap((file) =>
        [
          ...readFileSync(file, "utf8").matchAll(
            /class(?:Name)?="[^"]*\b((?!filter-)[a-z]+-chip)\b/g,
          ),
        ].map(([, name]) => `${file}: .${name}, a second chip style`),
      ),
      ...ownCss().flatMap(([file, css]) =>
        [...css.matchAll(/\.((?!filter-)[a-z]+-chip)\b(?!-)/g)].map(
          ([, name]) => `${file}: .${name}, a second chip style`,
        ),
      ),
    ],
  },
  {
    // Prevents the segmented navigation's old drop shadow (2026-10-21): the design is flat, so
    // depth is for surfaces that float over the page (a menu, a sheet, a cover), never a control.
    // Allowed: no shadow, an inset line or a ring drawn with a spread (`0 0 0`, `inset`, a hairline
    // under an edge), and the named floating tokens. A blurred shadow of any other kind, such as
    // --shadow-raised, fails.
    name: "has no box-shadow that lifts a control: shadows are for floating surfaces",
    offenders: () => {
      const floating =
        /^(none|inset\b.*|0 0 0 .*|0 calc\(.*\) 0 .*|var\(--(?:shadow-(?:popover|floating|sheet)|cover-shadow|sheet-shadow)\))$/;
      return ownCss().flatMap(([file, css]) =>
        [...css.matchAll(/box-shadow\s*:\s*([^;{}]+);/g)].flatMap(([, raw = ""]) => {
          const value = raw.replace(/\s+/g, " ").trim();
          const layers = value.split(/,(?![^(]*\))/).map((layer) => layer.trim());
          return layers.every((layer) => floating.test(layer))
            ? []
            : [`${file}: box-shadow: ${value}`];
        }),
      );
    },
  },
  {
    // Prevents colour drifting out of the token files through markup or script: a hex or rgb()
    // literal in a component or island ships a colour that dark mode, forced-colors and the
    // contrast checks never see. Colour comes from a token, through a class.
    name: "source files hold no colour literal: colour comes from the tokens",
    offenders: () =>
      sourceFiles().flatMap((file) => {
        if (RAW_COLOR_ALLOWED.some(([allowed]) => allowed === posix(file))) return [];
        const match = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|oklab|oklch)\(/.exec(
          readFileSync(file, "utf8"),
        );
        return match ? [`${posix(file)}: ${match[0]}`] : [];
      }),
  },
  {
    // Prevents a one-off weight, family or shorthand: type is set by the --font-* tokens (and the
    // --text-* roles), so a raw `font-weight: 500` is a third style nobody can change in one place.
    name: "font weight and family come from tokens, never a raw value",
    offenders: () =>
      // fonts.css is generated: it declares the faces themselves.
      ownCss()
        .filter(([file]) => file !== "fonts.css")
        .flatMap(([file, css]) =>
          rulesOf(css).flatMap(([selector, body]) =>
            declarationsOf(body)
              .filter(([property, value]) => {
                const own = value.replace(/var\([^()]*(?:\([^()]*\)[^()]*)*\)/g, "token");
                if (property === "font-weight") return !/^(?:token|inherit|initial)$/.test(own);
                if (property === "font-family") return !/^(?:token|inherit)$/.test(own);
                if (property === "font") return own !== "inherit";
                return false;
              })
              .map(([property, value]) => `${file}: ${selector} { ${property}: ${value} }`),
          ),
        ),
  },
  {
    // Prevents motion that ignores the curve tokens: a literal cubic-bezier(), a named ease or a
    // bare `linear` in an own stylesheet is a curve the motion review never sees. Use var(--ease-*).
    name: "easing curves come from the --ease tokens, never a literal curve",
    offenders: () =>
      ownCss().flatMap(([file, css]) =>
        rulesOf(css).flatMap(([, body]) =>
          declarationsOf(body)
            .filter(([property, value]) => {
              if (!/^(?:transition|animation)(?:-timing-function)?$/.test(property)) return false;
              const own = value.replace(/var\([^()]*(?:\([^()]*\)[^()]*)*\)/g, "token");
              return /cubic-bezier\(|\blinear\b|\bease(?:-in|-out|-in-out)?\b|steps\(/.test(own);
            })
            .map(([property, value]) => `${file}: ${property}: ${value}`),
        ),
      ),
  },
  {
    // Prevents a curve defined beside a component instead of in tokens.css.
    name: "an --ease custom property is defined only in tokens.css, bar the named exceptions",
    offenders: () =>
      ownCss().flatMap(([file, css]) =>
        [...css.matchAll(/(--ease-[\w-]+)\s*:/g)]
          .filter(([, name]) => !LOCAL_EASES.some(([allowed]) => allowed === `${file} ${name}`))
          .map(([, name]) => `${file}: ${name}`),
      ),
  },
  {
    // Prevents icons drawn outside the glyph set: a pasted <path> is a stroke weight, a size and a
    // style the set (Phosphor regular, tokens/glyphs.json) does not control. Icons go through the
    // Icon component; the files allowed are the Icon components themselves and named artwork.
    name: "no raw <svg> or <path> in components: icons go through the Icon component",
    offenders: () =>
      filesUnder(SRC, [".astro", ".tsx"])
        .filter((file) => !RAW_SVG_ALLOWED.some(([allowed]) => allowed === posix(file)))
        .filter((file) => /<svg\b|<path\b/.test(readFileSync(file, "utf8")))
        .map((file) => `${posix(file)}: a raw <svg>`),
  },
  {
    // Prevents script painting: a script may place and move things (width, top, transform), but a
    // colour, type, spacing or border set from script skips the token scale and the stylesheets.
    name: "script sets no design value on an element's style: geometry only",
    offenders: () =>
      sourceFiles().flatMap((file) =>
        [
          ...readFileSync(file, "utf8").matchAll(
            /\.style\.(color|background\w*|font\w*|padding\w*|margin\w*|border\w*|boxShadow|outline\w*|letterSpacing|lineHeight|zIndex|transition\w*|animation\w*|opacity)\s*=/g,
          ),
        ].map(([match]) => `${posix(file)}: ${match}`),
      ),
  },
  {
    // Prevents a second button, chip or pill style: a new control needs the shared .button-*, .icon-btn,
    // .chip or .filter-chip classes. A control-named class styled outside buttons.css and
    // primitives.css must be one of the named bespoke ones, each with why.
    name: "a control-named class is styled in buttons.css or primitives.css, or is a named bespoke one",
    offenders: () =>
      ownCss()
        .filter(([file]) => !SHARED_CONTROL_SHEETS.includes(file))
        .flatMap(([file, css]) =>
          rulesOf(css).flatMap(([selector]) =>
            [...selector.matchAll(/\.([a-z0-9-]*-(?:btn|button|fab|chip|pill|toggle))\b(?!-)/g)]
              .map(([, name = ""]) => name)
              .filter(
                (name) =>
                  !SHARED_CONTROLS.includes(name) &&
                  !BESPOKE_CONTROLS.some(([allowed]) => allowed === name),
              )
              .map((name) => `${file}: .${name}`),
          ),
        ),
  },
  {
    // Prevents a page-specific gutter: Settings once pushed its title in by a card's padding and sat
    // 24px off Latest and Library. A view root takes its inline edges from the shared layout.
    name: "a view root class sets no inline padding, inline margin or max width of its own",
    offenders: () =>
      ownCss().flatMap(([file, css]) =>
        rulesOf(css).flatMap(([selector, body]) => {
          const subjects = selector
            .replace(/:[a-z-]+\((?:[^()]|\([^()]*\))*\)/g, "")
            .split(",")
            .map((part) =>
              part
                .trim()
                .split(/\s*[>+~]\s*|\s+/)
                .pop(),
            )
            .filter((subject) =>
              VIEW_ROOTS.some((root) => new RegExp(`\\.${root}(?![\\w-])`).test(subject ?? "")),
            );
          const edges = declarationsOf(body).filter(([property]) => VIEW_EDGE.test(property));
          return subjects.length > 0
            ? edges.map(([property]) => `${file}: ${selector} ${property}`)
            : [];
        }),
      ),
  },
  {
    // Prevents an unstyled or one-off button in markup or a script: every <button> carries a shared
    // control class or a named bespoke one, so it inherits the press, focus and hit-area rules.
    name: "every <button> wears a shared control class or a named bespoke one",
    offenders: () =>
      sourceFiles().flatMap((file) =>
        buttonsIn(readFileSync(file, "utf8"))
          .filter(({ classes }) => classes !== undefined && !systemButton(classes))
          .map(({ tag }) => `${posix(file)}: ${tag.replace(/\s+/g, " ").slice(0, 80)}`),
      ),
  },
  {
    // Prevents an outlined control (owner, 2026-11-03: the floating button had "a thin outline that
    // shouldnt be there"): a control is a tonal shape, and an outline is a text field's (D54, D72). A
    // rule that names a control's class (a shared, bespoke, label or control-named one, a Button's, or
    // one a button wears) draws no visible border, resting outline or ring. Allowed: a focus ring, the
    // field family, a transparent border (it holds the size where forced colours draw one), a system
    // colour (the forced-colours edge) and a line on one side (a divider, as between segments).
    name: "a control draws no outline: outlines are for text fields",
    offenders: () => {
      const controls = new Set([
        ...SHARED_CONTROLS,
        ...BESPOKE_CONTROLS.map(([name]) => name),
        ...LABEL_CONTROLS,
        ...(COMPONENTS.find(({ name }) => name === "Button")?.classes ?? []),
        ...wornByButtons(),
      ]);
      const control = (name: string) =>
        controls.has(name) || /-(?:btn|button|fab|chip|pill|toggle)$/.test(name);
      const hidden = (value: string) =>
        /^(?:0|none)(?:\s|$)|\btransparent\b|\b(?:ButtonText|ButtonBorder|CanvasText|Highlight(?:Text)?|GrayText)\b/.test(
          value,
        );
      // What :not() and :has() test is not the element itself: `:not(:focus-visible)` is at rest.
      const group = String.raw`\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)`;
      const negated = new RegExp(`:not${group}`, "g");
      const has = new RegExp(`:has${group}`, "g");
      return ownCss().flatMap(([file, css]) =>
        rulesOf(css).flatMap(([selector, body]) => {
          const rule = `${file}: ${selector.replace(/\s+/g, " ")}`;
          if (OUTLINED_CONTROLS.some(([allowed]) => allowed === rule)) return [];
          const named = selectorsOf(selector).some((part) => {
            const own = part.replace(negated, "");
            if (/:focus/.test(own)) return false;
            const classes = [...own.replace(has, "").matchAll(/\.([\w-]+)/g)].map(
              ([, name = ""]) => name,
            );
            return classes.some(control) && !classes.some((name) => FIELDS.includes(name));
          });
          if (!named) return [];
          return declarationsOf(body)
            .filter(([property, value]) =>
              /^(?:border|outline)(?:-(?:width|style|color))?$/.test(property)
                ? !hidden(value)
                : property === "box-shadow" &&
                  value
                    .split(/,(?![^(]*\))/)
                    .some(
                      (layer) =>
                        /^(?:inset )?0 0 0 (?!0(?:\s|$))\S/.test(layer.trim()) && !hidden(layer),
                    ),
            )
            .map(([property, value]) => `${rule} { ${property}: ${value.replace(/\s+/g, " ")} }`);
        }),
      );
    },
  },
];

describe("house rules", () => {
  it.each(RULES)("$name", ({ offenders }) => {
    expect(offenders()).toEqual([]);
  });
});

/**
 * The page rules that still restyle a design-system component's classes, each as "file: selector".
 * A component is fixed in its own sheet, never bent on one page (AGENTS.md, D253, owner, 2026-10-30:
 * "whenever I ask you to fix a UI component, first attempt to fix/improve the centralized design
 * system component"). A page rule that overrides a Button is debt: moving it into the component
 * deletes a line here, and this list only shrinks. Naming the selector, not counting them, means a
 * rule swapped for another one on the same page fails too. It reads a component's own classes only:
 * a class a page passes to a Button (`class="structure-reorder"`) and then restyles is a known gap,
 * not yet caught. Without this a new override passes every other test and the component quietly
 * forks, page by page.
 */
const PAGE_OVERRIDES: string[] = [
  "banner.css: .banner-notice > .button-text",
  "banner.css: .banner-notice > .icon-glyph",
  "buttons.css: .chip-glyph .icon-glyph",
  "buttons.css: .dialog-actions > :is(.button-filled, .button-tonal)",
  "buttons.css: .icon-btn .icon-glyph",
  "buttons.css: .swap > .icon-glyph",
  "cover.css: .cover-play .icon-glyph",
  "create-sheet.css: .app-nav-create .icon-glyph",
  "create-sheet.css: .play-fab-glyph > .icon-glyph",
  'create-sheet.css: .play-fab[data-state="preparing"] .play-fab-glyph > .icon-glyph',
  "create-sheet.css: .share-dialog > .sheet-head",
  "create.css: .create-error > .icon-glyph",
  'create.css: .create-submit .button-filled[aria-disabled="true"]:active',
  'create.css: .create-submit .button-filled[data-busy="true"]',
  "create.css: .create-view .button-filled > .spinner",
  'create.css: .create-view .button-filled[data-busy="true"] > .spinner',
  "create.css: .create-view .create-submit > .button-filled",
  "create.css: .create-view .field-input.create-title",
  "create.css: .create-view .field-input.create-title",
  "create.css: .create-view .field-input.create-title:focus, .create-view .field-input.create-title:focus-visible",
  "create.css: .create-view .field-input.create-title:focus-visible",
  "create.css: .create-view .field-input.create-title:where(:enabled):hover",
  "empty.css: .empty-actions > .button-filled, .empty-actions > .button-tonal",
  "library.css: .card-more .icon-glyph",
  "library.css: .library-filters > .filter-chip > .icon-glyph",
  "library.css: .menu-list.card-menu-list",
  "library.css: .menu-list.card-menu-list",
  "library.css: .shelf-head > .button-text",
  "library.css: .status-mark .icon-glyph",
  "manage.css: .manage-error .icon-glyph",
  "manage.css: .manage-fields:disabled :is(.switch-input, .field-input, .search-field)",
  "manage.css: .manage-fields:disabled :is(.switch-input, .field-input, .search-field)",
  "menu.css: .menu-sheet .menu-item .icon-glyph",
  "menu.css: .menu-sheet > .sheet-head:not([data-has-back])",
  "menu.css: .menu-sheet > .sheet-head:not([data-has-back])",
  "menu.css: .menu-sheet:has(> .menu-sheet-items > .menu-item:not([hidden], .menu-item-danger)):not( :has( > .menu-sheet-items > .menu-item:not([hidden]) ~ .menu-item:not([hidden]), > .menu-sheet-items > .menu-item-danger:not([hidden]), > .menu-sheet-items > .menu-tiles ) ) > .sheet-head:not([data-has-back])",
  "multiselect.css: .multiselect-trigger > .icon-glyph",
  "multiselect.css: .multiselect-trigger > .icon-glyph",
  'multiselect.css: .multiselect-trigger[aria-expanded="true"] > .icon-glyph',
  "multiselect.css: .settings-row .multiselect-trigger > .icon-glyph",
  "picker.css: .picker > .icon-glyph",
  "picker.css: .picker > .icon-glyph",
  // The picker's rows place the Flag in their grid (D367): a column and the gap, not its look.
  "picker.css: .picker-option > .flag-mark",
  "picker.css: .picker-option:has(> .flag-mark)",
  'picker.css: .picker-option[aria-selected="true"]:has(> .flag-mark)::after',
  'picker.css: .picker:has(> .picker-trigger[aria-expanded="true"]) > .icon-glyph',
  "player.css: .dock-btn[data-primary] .icon-glyph",
  "player.css: .dock-expand .icon-glyph",
  "player.css: .dock-expand .icon-glyph",
  'player.css: .dock-expand[aria-expanded="true"] .icon-glyph',
  "player.css: .glyph-swap > .icon-glyph",
  "player.css: .glyph-swap > .icon-glyph",
  "player.css: .player-meta-line > .banner-notice",
  "player.css: .player-source-link .icon-glyph",
  "player.css: .transport-btn .icon-glyph",
  "podcast.css: .daily-panel .field-input[aria-invalid]:focus-visible",
  "podcast.css: .daily-panel input.field-input",
  "podcast.css: .daily-panel input.field-input:focus-visible",
  "podcast.css: .daily-panel input.field-input[aria-invalid]",
  "primitives.css: .card-group .settings-row[data-models] .value-select > select.field-input",
  "primitives.css: .card-group-accent :is(.settings-hint, .button-text)",
  "primitives.css: .filter-chip > .icon-glyph",
  "primitives.css: .filter-chip > .icon-glyph",
  "primitives.css: .filter-chip:has(input:checked) > .icon-glyph",
  "primitives.css: .segmented-nav-tab:has(> .icon-glyph)",
  "primitives.css: .source-link .icon-glyph",
  "primitives.css: .suggest-box > .icon-glyph",
  "queue.css: .menu-list.queue-pop",
  "queue.css: .menu-list.queue-pop, .menu-list.queue-pop:popover-open",
  "queue.css: .menu-list.queue-pop:popover-open",
  "queue.css: .queue-details-actions .button-filled",
  "queue.css: .queue-details-actions .button-text",
  "queue.css: .queue-end-icon .icon-glyph",
  "queue.css: .queue-ring[data-ended] .queue-stage-icon .icon-glyph",
  "queue.css: .queue-stage-icon > .icon-glyph",
  "queue.css: .queue-stage-icon > .icon-glyph, .queue-stage-icon > .icon-glyph[data-leaving]",
  "queue.css: .queue-stage-icon > .icon-glyph[data-leaving]",
  "select.css: .select-outlined > .icon-glyph",
  "select.css: .select-outlined > .icon-glyph",
  "select.css: .select-tonal > .icon-glyph",
  "settings.css: .settings-row .value-select > .icon-glyph",
  "settings.css: .settings-row .value-select > .icon-glyph",
  "settings.css: .settings-row .value-select > .icon-glyph",
  "settings.css: .settings-row .value-select > select.field-input",
  "settings.css: .settings-row .value-select > select.field-input:focus-visible",
  "settings.css: .settings-row .value-select > select.field-input:open",
  "settings.css: .settings-row .value-select > select.field-input:where(:enabled):active",
  "settings.css: .settings-row .value-select > select.field-input:where(:enabled):hover",
  "settings.css: .settings-row .value-select:has(> select:open) > .icon-glyph",
  "settings.css: .settings-row:is([data-quiet], :has(.slider-input:disabled)) .settings-label",
  "settings.css: .settings-row[data-models] .value-select > select.field-input",
  "settings.css: .settings-view .value-select > select.field-input",
  "settings.css: .settings-view:not([data-ready]) .slider-input::-moz-range-progress",
  "settings.css: .settings-view:not([data-ready]) .slider-input::-moz-range-thumb",
  "settings.css: .settings-view:not([data-ready]) .slider-input::-webkit-slider-thumb",
  "settings.css: .settings-view:not([data-ready]) .switch-input",
  "settings.css: .settings-view:not([data-ready]) .switch-input::before",
  "settings.css: :is(.settings-view, .manage) .row-action .icon-glyph",
  "settings.css: :where(.settings-row) > .slider-input",
  "sheet.css: dialog.sheet-side .create-submit > .button-filled",
  'sheets.css: .sheet-actions .button-filled[aria-disabled="true"]:active',
  'sheets.css: .sheet-actions .button-filled[data-busy="true"]',
  "sheets.css: .sheet-field-error .icon-glyph",
  "shell.css: .app-nav-indicator > .icon-glyph",
  "shell.css: .app-nav-item .icon-glyph",
  "shell.css: .app-nav-item:active .icon-glyph",
  "speed-panel.css: .player-speed .slider-input",
  "story-controls.css: .menu-list.story-menu-list",
  "story-controls.css: .menu-list.story-menu-list",
  "story-controls.css: .story-vote .icon-glyph",
  'story-controls.css: .story-vote .icon-glyph:last-child, .story-vote[aria-pressed="true"] .icon-glyph:first-child',
  'story-controls.css: .story-vote[aria-pressed="true"] .icon-glyph:last-child',
  "story-controls.css: .story-vote[data-just-voted] .icon-glyph:last-child",
  "story-controls.css: .story-vote[data-just-voted] .icon-glyph:last-child",
  "topics.css: .menu-list.emoji-picker",
  "topics.css: .menu-list.emoji-picker",
  "topics.css: .menu-list.emoji-picker:popover-open",
  "topics.css: .menu-list.menu-sheet.emoji-picker, .menu-list.menu-sheet.emoji-picker:popover-open",
  "topics.css: .source-sheet-foot > .button-filled",
  "topics.css: .topic-weight > .slider-input",
  "topics.css: .topic-weight > .slider-input",
  "topics.css: .topics .row-action .icon-glyph",
  "topics.css: .topics .row-action .topic-blocked-mark > .icon-glyph",
  'topics.css: .topics-panel .card-group :is(input, textarea).field-input:not( :focus-visible, [readonly], [aria-invalid]:not([aria-invalid="false"]) )',
  'topics.css: .topics-panel .card-group :is(input, textarea).field-input:not( :focus-visible, [readonly], [aria-invalid]:not([aria-invalid="false"]) ):where(:enabled):hover',
  "topics.css: .topics-panel .field-input[readonly]",
  'topics.css: .topics-panel select.field-input, .topics-panel .multiselect-trigger, .topics-panel :is(input, textarea).field-input:not( :focus-visible, [readonly], [aria-invalid]:not([aria-invalid="false"]) )',
  "topics.css: .topics-panel select.field-input:focus-visible, .topics-panel .multiselect-trigger:focus-visible",
  'topics.css: .topics-panel select.field-input:where(:enabled):active, .topics-panel .multiselect-trigger:is(:active, [aria-expanded="true"])',
  'topics.css: .topics-panel select.field-input:where(:enabled):hover, .topics-panel .multiselect-trigger:hover, .topics-panel :is(input, textarea).field-input:not( :focus-visible, [readonly], [aria-invalid]:not([aria-invalid="false"]) ):where(:enabled):hover',
  "topics.css: dialog.sheet-side.topics-panel",
];

describe("design-system components in page stylesheets", () => {
  it("are restyled only where the debt list says", () => {
    const found: string[] = [];
    for (const component of COMPONENTS) {
      const named = new RegExp(`\\.(?:${component.classes.join("|")})(?![\\w-])`);
      for (const [file, css] of ownCss()) {
        if (file === component.sheet) continue;
        // A rule's selector is the text before its `{`; an at-rule's own prelude names no class.
        for (const [, prelude] of css.matchAll(/([^{}]+)\{/g)) {
          const selector = (prelude ?? "").replace(/\s+/g, " ").trim();
          if (named.test(selector)) found.push(`${file}: ${selector}`);
        }
      }
    }
    expect(
      found.sort(),
      "change the component in its own stylesheet (a design-system PR) instead of overriding it on a page; this list only shrinks",
    ).toEqual(PAGE_OVERRIDES);
  });
});

describe("component stylesheets", () => {
  it("covers every stylesheet the layout or an island imports", () => {
    // The command center (D224) imports the Costs and Health sheets from here.
    const sources = [SRC, join(SRC, "..", "..", "admin", "src")].flatMap((src) =>
      readdirSync(src, { recursive: true, encoding: "utf8" })
        .filter((file) => /\.(astro|tsx)$/.test(file))
        .map((file) => readFileSync(join(src, file), "utf8")),
    );
    const imported = sources.flatMap((text) =>
      [...text.matchAll(/styles\/([a-z-]+\.css)/g)].map((match) => match[1]),
    );
    for (const file of OWN_FILES) expect(imported, `${file} is never imported`).toContain(file);
  });

  it("reads no custom property that nothing defines", () => {
    // `var(--space-5)` with no --space-5 is not an error to the browser: the whole declaration is
    // dropped, silently. A property with a fallback is one that script or a library may set.
    const src = SRC;
    const sources = readdirSync(src, { recursive: true, encoding: "utf8" })
      .filter((file) => /\.(css|astro|tsx|ts)$/.test(file) && !/\.(test|spec)\.tsx?$/.test(file))
      .map((file) => readFileSync(join(src, file), "utf8"));
    const defined = new Set(
      sources.flatMap((text) =>
        [
          ...text.matchAll(/(--[a-z0-9-]+)\s*:/gi),
          ...text.matchAll(/@property\s+(--[a-z0-9-]+)/gi),
          ...text.matchAll(/["'`](--[a-z0-9-]+)["'`]/gi),
        ].map((match) => match[1]),
      ),
    );
    for (const file of [...OWN_FILES, "foundations.css"]) {
      for (const [, name] of withoutComments(read(file)).matchAll(
        /var\(\s*(--[a-z0-9-]+)\s*\)/gi,
      )) {
        expect(defined.has(name), `${file} reads ${name}, which nothing defines`).toBe(true);
      }
    }
  });

  it("takes every hover and press fill from a state token, never an alpha layer (D317)", () => {
    // A hover on a fill is the fill's own hover token (`--color-accent-hover`); a hover on a control
    // with no fill is the surface behind it, stepped (`--ghost-hover`, set by the container). A layer
    // of the label colour over transparent dulled a fill and read as nothing on a tinted one. The two
    // layers left are over artwork, where no solid colour can stand in: the ripple and a cover's press.
    const OVER_ART = new Set(["ripple.css", "library.css"]);
    const mixes = /color-mix\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)/g;
    for (const [file, css] of ownCss()) {
      if (file === "tokens.css") continue;
      for (const [mix] of css.matchAll(mixes)) {
        if (!/--state-(hover|press)\b/.test(mix)) continue;
        expect(OVER_ART.has(file), `${file}: an alpha layer outside artwork: ${mix}`).toBe(true);
        expect(mix, `${file}: a mix over a fill`).toMatch(/transparent\s*\)$/);
      }
      expect(css, `${file} steps lightness by hand`).not.toMatch(/--state-step-/);
      // The cover turns its own hue; the hue slider paints the style's accent at every turn (D328).
      // Neither steps a state.
      if (!["cover.css", "slider.css", "avatar.css"].includes(file))
        expect(css, `${file} derives a color by hand`).not.toMatch(/oklch\(from /);
    }
  });

  it("gives a container that paints its own surface the ghost pair for it (D317)", () => {
    // A control with no fill steps the surface behind it. The pair defaults to the page's, so a rule
    // that records another surface behind its controls (`--color-focus-gap`) must set its own, or a
    // hover there would step the wrong tone.
    for (const [file, css] of ownCss()) {
      if (file === "tokens.css") continue;
      for (const block of css.matchAll(/\{([^{}]*)\}/g)) {
        const body = block[1] ?? "";
        if (
          !/--color-focus-gap:\s*var\(--(?:color-surface-(?:raised|overlay|inverse|container)|mini-player-bg)\)/.test(
            body,
          )
        )
          continue;
        expect(body, `${file}: ${body.trim().slice(0, 60)}`).toMatch(/--ghost-hover:/);
        expect(body, `${file}: ${body.trim().slice(0, 60)}`).toMatch(/--ghost-pressed:/);
      }
    }
  });

  it("writes a scroll timeline with the animation longhands, never the shorthand", () => {
    // The build's minifier folds `animation` and `animation-timeline` of one rule into a single
    // shorthand declaration, which Chrome rejects: the fade or the line then never runs.
    for (const file of OWN_FILES) {
      const css = withoutComments(read(file));
      for (const block of css.matchAll(/\{([^{}]*)\}/g)) {
        const body = block[1] ?? "";
        if (!/animation-timeline\s*:/.test(body)) continue;
        expect(body, `${file}: ${body.trim().slice(0, 60)}`).not.toMatch(
          /(?:^|[;\s])animation\s*:/,
        );
      }
    }
  });

  it("mixes no colour for words or a fill in a page sheet, so the contrast sweep measures every one", () => {
    // A `color-mix` written here is a colour scripts/buildTokens.test.ts never measures: the open
    // story's muted ink (4.15:1) and its spoken word (3.56:1) fell under 4.5:1 in Expressive dark
    // that way. Such a colour is a token (a `singularity-mix-color` when it is a mix); only art mixes
    // here, where no token colour can stand in. A custom property counts, since a fill reads it.
    const ART: [where: string, reason: string][] = [
      ["avatar.css", "the avatar's own shading, mixed from its two tones (D326)"],
      ["empty.css .empty-art", "the empty-state art's detail tone, between its hero and its ink"],
      [
        "library.css .card-link .cover::after",
        "the press layer over a cover's art, which has no one colour",
      ],
      ["ripple.css .ripple-wave", "the press wave, which crosses the bar and its current pill"],
    ];
    const painted = /^(?:color|background(?:-color|-image)?|fill|--[\w-]+)$/;
    const found = ownCss().flatMap(([file, css]) =>
      rulesOf(css).flatMap(([raw, body]) => {
        const selector = raw.replace(/\s+/g, " ");
        if (ART.some(([where]) => where === file || where === `${file} ${selector}`)) return [];
        return [...body.matchAll(/(?:^|;)\s*(--[\w-]+|[a-z-]+)\s*:\s*([^;]+)/g)]
          .filter(
            ([, property = "", value = ""]) => painted.test(property) && /color-mix\(/.test(value),
          )
          .map(([, property]) => `${file}: ${selector} { ${property} }`);
      }),
    );
    expect(found).toEqual([]);
  });

  it("paints every primary action with the one primary fill, so a floating button never drifts from Play", () => {
    // The filled button, the hero's Play (hero.css, through --chip-bg), the floating buttons and the
    // side column's Catch up are one action, so one colour: the floating ones wore the tonal step and
    // Catch up a tone of its own, each a second primary beside Play (owner, 2026-11-04). A disabled
    // face is the only other fill.
    const PRIMARY = ["button-filled", "create-fab", "play-fab", "btn-action-tonal"];
    const groups = /:(?:where|not|is)\((?:[^()]|\([^()]*\))*\)/g;
    const found = ownCss().flatMap(([file, css]) =>
      rulesOf(css).flatMap(([list, body]) => {
        const subjects = selectorsOf(list).filter((selector) => {
          const subject =
            selector
              .trim()
              .split(/[\s>+~]+/)
              .pop() ?? "";
          const own = subject.replace(groups, "");
          return (
            PRIMARY.some((name) => wholeName(`.${name}`).test(own)) &&
            !/\[aria-disabled="true"\]|:disabled/.test(own)
          );
        });
        if (subjects.length === 0) return [];
        return declarationsOf(body)
          .filter(([property]) => property === "background" || property === "background-color")
          .filter(([, value]) => !/^var\(--cta-bg(?:-hover|-pressed)?\)$/.test(value))
          .map(
            ([property, value]) =>
              `${file}: ${list.replace(/\s+/g, " ")} { ${property}: ${value} }`,
          );
      }),
    );
    expect(found).toEqual([]);
  });

  it("draws no stop marks on a slider's track, in any mood", () => {
    // 2026-11-04: the "no dots please" fix (owner, 2026-11-03) went into the Expressive rule alone, so
    // Default and Halloween still drew the speed and weight stops. A track is plain in every mood.
    const marks = ownCss().flatMap(([file, css]) =>
      rulesOf(css)
        .filter(([list]) => /\.slider-input\b/.test(list))
        .flatMap(([list, body]) =>
          declarationsOf(body)
            // A mark is a background image on the input itself, or a gradient kept in a variable for one.
            .filter(
              ([property, value]) =>
                (property === "background-image" && value !== "none") ||
                /radial-gradient\(/.test(value),
            )
            .map(([property]) => `${file}: ${list.replace(/\s+/g, " ")} { ${property} }`),
        ),
    );
    expect(marks).toEqual([]);
  });
});

describe("source files", () => {
  const ROOT = join(STYLES, "..", "..");
  const SKIP = new Set(["node_modules", "dist", ".astro", ".vercel", "test-results"]);

  function files(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      if (SKIP.has(entry.name)) return [];
      const path = join(directory, entry.name);
      return entry.isDirectory() ? files(path) : [path];
    });
  }

  const TEXT = new Set([
    ".ts",
    ".tsx",
    ".astro",
    ".css",
    ".js",
    ".mjs",
    ".json",
    ".svg",
    ".txt",
    ".md",
  ]);

  it("has no em or en dashes anywhere, in code, copy or tests", () => {
    const dashes = new RegExp(`[${String.fromCharCode(0x2014)}${String.fromCharCode(0x2013)}]`);
    for (const file of files(ROOT).filter((path) => TEXT.has(extname(path)))) {
      expect(dashes.test(readFileSync(file, "utf8")), `${file} contains a dash`).toBe(false);
    }
  });

  it("has no placeholder text", () => {
    const placeholder = /\b(lorem ipsum|TODO|FIXME|XXX|placeholder text|coming soon)\b/i;
    for (const file of files(join(ROOT, "src")).filter(
      (path) => TEXT.has(extname(path)) && !path.endsWith(".test.ts"),
    )) {
      expect(placeholder.exec(readFileSync(file, "utf8"))?.[0], file).toBeUndefined();
    }
  });
});
