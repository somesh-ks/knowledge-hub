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
  "segmented",
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
  "hero-menu-item",
  "story-row",
  "player-upnext-row",
  "player-notice-action",
  "player-fallback-action",
  "script-back",
  "speed-btn",
  "speed-preset",
];

/**
 * The only rules that may space with --space-1 (4px), each with why. Everything else spaces on the
 * 8pt grid: a 4px gap between two rows, or under a heading, reads as the two touching. A selector
 * matches when it contains the entry as a whole name.
 */
const ALLOWED_4PX: [selector: string, reason: string][] = [
  [".aside", "the rail's hit area reaching past the column's edge"],
  [".aside-rail", "the rail's track padding, around its own segments"],
  [".banner > .button-text", "the action's hit area reaching into the banner's padding"],
  [".banner-body", "a banner's title onto its body, inside one banner"],
  [".structure-row", "the dots' and pencil's ink, 28px in from the card's corner, not 24"],
  [
    ".structure-profile .profile-select",
    "the chevron in the rows column: its ink 28px in, as the dots and pencil",
  ],
  [".story", "an optical nudge: the row's bottom half-gap less the chips' hit-area overhang"],
  [".create-fab-label", "the button's own inner gap at the label's end"],
  [".create-sheet-head", "the header's 44px buttons, offset to the edge as a hit area"],
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
  [".manage-text", "title onto its subtitle inside one row"],
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
  [".sort-field > select::picker(select)", "the list's edge onto the label's outline"],
  [".meta-wrap", "the meta link's hit area reaching past its words"],
  [".segmented-choice-item", "the check glyph beside its own segment label"],
  [".segmented-nav", "a segmented track: the pill inset by its 4px track padding"],
  [".settings-text", "title onto its subtitle inside one row"],
  [
    ".costs-answer",
    "a figure's label onto the figure, and the figure onto its line, inside one block",
  ],
  [".sheet-hint-title", "title onto its body inside one card"],
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
];

/** Files that may hold an inline <svg>: the Icon components, the mark, the art and named one-offs. */
const RAW_SVG_ALLOWED: [file: string, reason: string][] = [
  ["components/Icon.astro", "the Icon component"],
  ["player/ui/Icon.tsx", "the island Icon component"],
  ["player/ui/LazyIcon.tsx", "the lazy island Icon component"],
  ["components/BrandMark.astro", "the wordmark's own mark, not a glyph"],
  ["components/EmptyArt.astro", "empty-state illustrations, coloured by classes (own rule above)"],
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

/** Controls styled in their own sheet or built bespoke, each with why they are not a shared one. */
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
  ["speed-btn", "the player's speed popover trigger"],
  ["speed-preset", "a speed option in the player's popover"],
  ["source-plus-btn", "the sources list's inline add control"],
  ["source-edit", "a text action on a source row"],
  ["source-remove", "a text action on a source row"],
  ["cover-play", "the cover's play overlay"],
  ["podcast-sample", "the podcast voice sample row control"],
  ["hero-menu-item", "a row of the hero's popover menu"],
  ["hero-menu-delete", "the menu's destructive row"],
  ["topic-delete", "the topic page's destructive menu row"],
  ["toast-action", "a toast's text action"],
  ["toast-dismiss", "a toast's close control"],
  ["multiselect-trigger", "the multi-select's field-like trigger"],
  ["search-clear", "the clear control inside .search-field"],
  ["player-notice-action", "a text action in the player's notice"],
  ["player-fallback-action", "a text action in the player's fallback card"],
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

/** A selector fragment as a whole name: `.aside` matches `.aside:hover`, not `.aside-x`. */
const wholeName = (fragment: string) =>
  new RegExp(`${fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`);

/** Every innermost rule of a stylesheet, as [selector, body]. */
const rulesOf = (css: string) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
    ([, selector = "", body = ""]) => [selector.trim(), body] as const,
  );

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
    offenders: () => {
      const art = readFileSync(join(SRC, "components", "EmptyArt.astro"), "utf8");
      const match = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|style=|\bfill="|\bstroke="/.exec(art);
      return match ? [`EmptyArt.astro: ${match[0]}`] : [];
    },
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
    // Prevents an unstyled or one-off button in markup: every <button> carries a shared control
    // class or a named bespoke one, so it inherits the press, focus and hit-area rules.
    name: "every <button> wears a shared control class or a named bespoke one",
    offenders: () =>
      filesUnder(SRC, [".astro", ".tsx"]).flatMap((file) =>
        [...readFileSync(file, "utf8").matchAll(/<button\b[^>]*>/g)].flatMap(([tag]) => {
          if (/class(?:Name)?=\{|class:list/.test(tag)) return [];
          const classes = /class(?:Name)?="([^"]*)"/.exec(tag)?.[1]?.split(/\s+/) ?? [];
          const known = classes.some(
            (name) =>
              SHARED_CONTROLS.includes(name) || BESPOKE_CONTROLS.some(([al]) => al === name),
          );
          return known ? [] : [`${posix(file)}: ${tag.replace(/\s+/g, " ").slice(0, 80)}`];
        }),
      ),
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
  "banner.css: .banner > .button-text",
  "create-sheet.css: dialog.create-sheet .create-submit > .button-filled",
  'create.css: .create-submit .button-filled[aria-disabled="true"]:active',
  'create.css: .create-submit .button-filled[data-busy="true"]',
  "create.css: .create-view .button-filled > .spinner",
  'create.css: .create-view .button-filled[data-busy="true"] > .spinner',
  "create.css: .create-view .create-submit > .button-filled",
  "empty.css: .empty-actions > .button-filled, .empty-actions > .button-tonal",
  "library.css: .shelf-head > .button-text",
  "manage.css: .manage-fields:disabled :is(.switch-input, .sort-field, .manage-input, .search-field)",
  "manage.css: .manage-row:has(.switch-input:not(:checked)) .slider-input",
  "manage.css: .manage-row:has(.switch-input:not(:checked)) .slider-input",
  "manage.css: .manage-weight > .slider-input",
  'manage.css: .manage[data-filter="pinned"] .manage-row[data-find]:not(:has([data-pin][aria-pressed="true"])), .manage[data-filter="off"] .manage-row[data-find]:not(:has(.switch-input:not(:checked))), .manage[data-filter="suggested"] [data-section-of="sources"], .manage:is([data-filter="pinned"], [data-filter="off"]) [data-section-of="suggested"]',
  "player.css: .speed-panel-body > .slider-input",
  "primitives.css: .card-group-accent :is(.settings-hint, .button-text)",
  "queue.css: .queue-details-actions .button-filled",
  "queue.css: .queue-details-actions .button-text",
  "settings.css: .settings-row:is([data-quiet], :has(.slider-input:disabled)) .settings-label",
  "settings.css: .settings-view:not([data-ready]) .slider-input::-moz-range-progress",
  "settings.css: .settings-view:not([data-ready]) .slider-input::-moz-range-thumb",
  "settings.css: .settings-view:not([data-ready]) .slider-input::-webkit-slider-thumb",
  "settings.css: .settings-view:not([data-ready]) .switch-input",
  "settings.css: .settings-view:not([data-ready]) .switch-input::before",
  "settings.css: :where(.settings-row) > .slider-input",
  'sheets.css: .sheet-actions .button-filled[aria-disabled="true"]:active',
  'sheets.css: .sheet-actions .button-filled[data-busy="true"]',
  "sheets.css: .sheet-hint-card .button-text",
  "topics.css: .slider-input[data-stops]",
  "topics.css: .source-sheet-foot > .button-filled",
  "topics.css: .structure-add > .button-tonal",
  "topics.css: .structure-prompt-foot > .button-text",
  "topics.css: .topic-weight > .slider-input",
  "topics.css: .topic-weight > .slider-input",
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
