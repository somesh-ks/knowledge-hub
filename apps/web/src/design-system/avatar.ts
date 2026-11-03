/**
 * The Avatar (D326): the reader's face in the app bar and on the profile page. One flat shape with a
 * face and two tones, never a letter, a gradient, a shadow or a blush. Avatar.astro renders from it; a
 * script or an island that draws one calls avatarMarkup(). The rules are in styles/avatar.css.
 *
 * No colour is written here: the markup carries classes, and avatar.css fills them from tokens, so the
 * hue engine drives every shape in every mood. A mood supplies tokens and nothing else (--av-body,
 * --av-mark, --av-shapes, --av-shape-default, --av-plays, --av-d-dots, --av-d-spark, --av-d-speckle, --av-d-stitch);
 * a new mood is a new block of those tokens, never a change to this file.
 *
 * The app reacts through two attributes it sets on the avatar: data-play for a one-shot (hop, wiggle,
 * look, blink, shake, and the tap's own: wave, scout, wink, wow, spin, boo, pop) and data-state for what
 * is really going on (playing, working, offline). Nothing loops by itself and none of it moves under
 * reduced motion. data-face (open, frown, flat, sleep) changes the mouth. A tap picks its reaction from
 * the mood's --av-plays (D353); the hand and the binoculars are hidden props that only a play shows.
 */
import type { Guidance } from "./guidance";

export const AVATAR: Guidance = {
  summary:
    "A flat shape with a face and two tones that stands for the reader: in the app bar, on the profile page, in the Mood picker.",
  useWhen: [
    "The reader is signed out, or signed in with no photo: it is the face the app gives them.",
    "A profile, an account or an Appearance row names who the settings belong to.",
  ],
  dontUseWhen: [
    {
      when: "The art stands for a podcast, a briefing or an episode: that is a cover (covers.json), not a face.",
    },
    {
      when: "A glyph says what a control does.",
      instead: "Icon",
    },
  ],
};

/** The sizes: the app bar's, a profile's and a profile page's. */
export type AvatarSize = "md" | "lg" | "xl";

/** Every class the Avatar draws, for the registry and its test. */
export const AVATAR_CLASSES: string[] = [
  "avatar",
  "avatar-lg",
  "avatar-xl",
  "avatar-photo",
  "avatar-rig",
  "avatar-body",
  "avatar-shade",
  "avatar-stem",
  "avatar-brew",
  "avatar-rib",
  "avatar-fang",
  "avatar-whisk",
  "avatar-dots",
  "avatar-speck",
  "avatar-stitch",
  "avatar-spark",
  "avatar-hand",
  "avatar-arm",
  "avatar-palm",
  "avatar-scope",
  "avatar-barrel",
  "avatar-lens",
  "avatar-eyes",
  "avatar-eye",
  "avatar-lit",
  "avatar-mouth",
  "avatar-smile",
  "avatar-open",
  "avatar-frown",
  "avatar-flat",
  "avatar-fill",
];

/** Classes the Avatar replaced; none exist yet. */
export const AVATAR_RETIRED: string[] = [];

/** The class that draws an avatar, sized. */
export const avatarClass = (size: AvatarSize = "md", photo = false): string =>
  ["avatar", size === "md" ? "" : `avatar-${size}`, photo ? "avatar-photo" : ""]
    .filter(Boolean)
    .join(" ");

/** What a shape is made of: parts of its body, a face placed on the grid, art of its own. */
interface Part {
  tag: "path" | "rect" | "ellipse" | "circle";
  attrs: string;
  /** body (clips the texture and takes the mood's body tone), or one of the shape's own tones. */
  tone: "body" | "stem" | "brew" | "shade";
  /** A part drawn mirrored. */
  transform?: string;
}

interface Face {
  /** The eyes' height, their distance from the middle, the mouth's height and half width. */
  ey: number;
  ex: number;
  my: number;
  mw: number;
}

interface Shape {
  name: string;
  /** A shape that is not the mood's body: ink (a ghost's, a bat's) or stone (a skull's). */
  tone?: "ink" | "stone";
  /** The eyes take the lit tone (a pumpkin's glow). */
  lit?: boolean;
  parts: Part[];
  face?: Face;
  /** Its own eyes and mouths, for a face that is not two ovals and a curve. */
  custom?: {
    eyes?: string;
    mouths?: { smile: string; open: string; frown: string; flat: string };
  };
  /** Art drawn over the body and under the face (ribs, fangs, whiskers). */
  extras?: string;
  /** A stitched seam. */
  stitch?: string;
}

const GENERIC: Face = { ey: 44, ex: 12, my: 58, mw: 13 };

const fixed = (n: number): string => n.toFixed(2);

/** A round outline with n lobes: a cookie, a flower, a clover, a star. "tri" makes pointed rays. */
function lobed(n: number, amp: number, kind?: "tri"): string {
  const radius = 47 / (1 + amp);
  const steps = 200;
  let d = "";
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * 2 * Math.PI - Math.PI / 2;
    const phase = (n * (t + Math.PI / 2)) / (2 * Math.PI);
    const wave =
      kind === "tri" ? 1 - 4 * Math.abs((phase % 1) - 0.5) : Math.cos(n * (t + Math.PI / 2));
    const r = radius * (1 + amp * wave);
    d += `${i ? "L" : "M"}${fixed(50 + r * Math.cos(t))} ${fixed(50 + r * Math.sin(t))}`;
  }
  return `${d}Z`;
}

/** A square that has been pressed round: the superellipse. */
function squircle(): string {
  const steps = 160;
  const power = 4.2;
  let d = "";
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const x = 50 + 46 * Math.sign(c) * Math.abs(c) ** (2 / power);
    const y = 50 + 46 * Math.sign(s) * Math.abs(s) ** (2 / power);
    d += `${i ? "L" : "M"}${fixed(x)} ${fixed(y)}`;
  }
  return `${d}Z`;
}

const body = (d: string, transform?: string): Part => ({
  tag: "path",
  attrs: `d="${d}"`,
  tone: "body",
  ...(transform ? { transform } : {}),
});

const WING = "M34 50 C26 38 12 36 4 44 C10 46 12 52 12 58 C18 55 24 57 28 65 C30 60 34 61 36 66Z";

/** Every shape an avatar can take. A mood lists the ids it offers in --av-shapes. */
export const AVATAR_SHAPES: Record<string, Shape> = {
  cookie: { name: "Cookie", parts: [body(lobed(9, 0.05))] },
  flower: { name: "Flower", parts: [body(lobed(6, 0.17))] },
  clover: {
    name: "Clover",
    parts: [body(lobed(4, 0.26))],
    face: { ey: 46, ex: 12, my: 60, mw: 13 },
  },
  sunny: { name: "Sunny", parts: [body(lobed(10, 0.12, "tri"))] },
  burst: { name: "Burst", parts: [body(lobed(14, 0.09, "tri"))] },
  squircle: { name: "Squircle", parts: [body(squircle())] },
  heart: {
    name: "Heart",
    parts: [
      body("M50 88 C12 60 6 36 21 23 C33 13 46 19 50 31 C54 19 67 13 79 23 C94 36 88 60 50 88Z"),
    ],
    face: { ey: 42, ex: 11, my: 55, mw: 10 },
  },
  pebble: {
    name: "Pebble",
    parts: [
      body("M52 8 C78 6 94 28 90 54 C86 80 66 94 44 90 C20 86 8 66 12 42 C16 20 32 10 52 8Z"),
    ],
    face: { ey: 46, ex: 12, my: 60, mw: 12 },
  },
  star: { name: "Star", parts: [body(lobed(5, 0.34))], face: { ey: 48, ex: 9, my: 60, mw: 10 } },
  pumpkin: {
    name: "Pumpkin",
    parts: [
      { tag: "rect", attrs: 'x="44" y="8" width="12" height="18" rx="4"', tone: "stem" },
      { tag: "ellipse", attrs: 'cx="30" cy="58" rx="22" ry="31"', tone: "body" },
      { tag: "ellipse", attrs: 'cx="70" cy="58" rx="22" ry="31"', tone: "body" },
      { tag: "ellipse", attrs: 'cx="50" cy="58" rx="22" ry="33"', tone: "body" },
    ],
    extras: '<path class="avatar-rib" d="M41 30 Q35 58 41 88 M59 30 Q65 58 59 88"/>',
    custom: {
      eyes: '<path class="avatar-eye" d="M31 52 L39 38 L47 52Z"/><path class="avatar-eye" d="M53 52 L61 38 L69 52Z"/>',
      mouths: {
        smile: "M30 62 L38 68 L44 62 L50 70 L56 62 L62 68 L70 62 Q50 84 30 62Z",
        open: "M30 62 L38 68 L44 62 L50 70 L56 62 L62 68 L70 62 Q50 92 30 62Z",
        frown: "M30 76 L38 70 L44 76 L50 68 L56 76 L62 70 L70 76 Q50 58 30 76Z",
        flat: "M32 70 L38 66 L44 70 L50 66 L56 70 L62 66 L68 70",
      },
    },
  },
  ghost: {
    name: "Ghost",
    tone: "ink",
    parts: [
      body(
        "M18 90 V48 C18 24 32 10 50 10 C68 10 82 24 82 48 V90 Q74 80 66 90 Q58 80 50 90 Q42 80 34 90 Q26 80 18 90Z",
      ),
    ],
    face: { ey: 44, ex: 11, my: 60, mw: 8 },
  },
  bat: {
    name: "Bat",
    tone: "ink",
    lit: true,
    parts: [
      body(WING),
      body(WING, "translate(100 0) scale(-1 1)"),
      { tag: "ellipse", attrs: 'cx="50" cy="54" rx="18" ry="18"', tone: "body" },
      body("M38 44 L37 22 L49 37Z"),
      body("M62 44 L63 22 L51 37Z"),
    ],
    face: { ey: 50, ex: 8, my: 62, mw: 6 },
    extras: '<path class="avatar-fang" d="M44 64 L46.5 70 L49 64Z M51 64 L53.5 70 L56 64Z"/>',
  },
  cat: {
    name: "Cat",
    tone: "ink",
    lit: true,
    parts: [
      body(
        "M20 44 L22 12 L44 28 Q50 26 56 28 L78 12 L80 44 Q86 52 86 60 Q86 90 50 90 Q14 90 14 60 Q14 52 20 44Z",
      ),
    ],
    face: { ey: 56, ex: 12, my: 69, mw: 7 },
    extras:
      '<path class="avatar-whisk" d="M8 64 L24 66 M8 72 L24 70 M92 64 L76 66 M92 72 L76 70"/>',
    stitch: "M62 76 Q70 80 78 74",
  },
  skull: {
    name: "Skull",
    tone: "stone",
    parts: [
      body(
        "M50 8 C26 8 14 24 14 42 C14 54 20 60 28 64 L28 80 Q28 90 38 90 L62 90 Q72 90 72 80 L72 64 C80 60 86 54 86 42 C86 24 74 8 50 8Z",
      ),
    ],
    custom: {
      eyes: '<ellipse class="avatar-eye" cx="36" cy="46" rx="8.5" ry="10"/><ellipse class="avatar-eye" cx="64" cy="46" rx="8.5" ry="10"/>',
    },
    face: { ey: 46, ex: 14, my: 76, mw: 11 },
    extras: '<path class="avatar-fang" d="M46 60 L54 60 L50 67Z"/>',
  },
  cauldron: {
    name: "Cauldron",
    tone: "ink",
    lit: true,
    parts: [
      { tag: "circle", attrs: 'cx="36" cy="26" r="6"', tone: "brew" },
      { tag: "circle", attrs: 'cx="54" cy="18" r="8"', tone: "brew" },
      { tag: "circle", attrs: 'cx="69" cy="30" r="5"', tone: "brew" },
      { tag: "rect", attrs: 'x="22" y="84" width="10" height="10" rx="3"', tone: "body" },
      { tag: "rect", attrs: 'x="68" y="84" width="10" height="10" rx="3"', tone: "body" },
      body("M16 42 H84 Q92 42 92 50 V60 Q92 90 54 90 H46 Q8 90 8 60 V50 Q8 42 16 42Z"),
      { tag: "ellipse", attrs: 'cx="50" cy="42" rx="36" ry="7"', tone: "shade" },
    ],
    face: { ey: 62, ex: 13, my: 74, mw: 11 },
    stitch: "M20 80 Q50 90 80 80",
  },
};

/** The shape ids, in the order the registry keeps them. */
export const AVATAR_SHAPE_IDS: string[] = Object.keys(AVATAR_SHAPES);

/** Dots that grow along the lower right of a body: Expressive's halftone. */
const DOTS = (() => {
  let out = "";
  for (let y = 40; y < 100; y += 8) {
    for (let x = 40; x < 100; x += 8) {
      const k = (x + y - 112) / 80;
      if (k <= 0) continue;
      out += `<circle cx="${x + (y % 16 ? 4 : 0)}" cy="${y}" r="${(0.9 + 2.3 * k).toFixed(2)}"/>`;
    }
  }
  return out;
})();

/** Specks, for a mood that wants a body with a grain (Halloween). */
const SPECK =
  '<circle cx="30" cy="34" r="1.8"/><circle cx="70" cy="30" r="1.5"/><circle cx="78" cy="58" r="1.8"/><circle cx="24" cy="62" r="1.5"/><circle cx="58" cy="82" r="1.6"/><circle cx="42" cy="20" r="1.3"/>';

/** A sparkle that flares on a hop, in a mood that switches it on. */
const SPARK = "M84 6 Q86 16 96 18 Q86 20 84 30 Q82 20 72 18 Q82 16 84 6Z";

const partMarkup = (part: Part): string =>
  `<${part.tag} ${part.attrs} class="${part.tone === "body" ? "avatar-body" : `avatar-${part.tone}`}"${
    part.transform ? ` transform="${part.transform}"` : ""
  }/>`;

function faceMarkup(shape: Shape): string {
  const face = shape.face ?? GENERIC;
  const custom = shape.custom ?? {};
  const lit = shape.lit ? " avatar-lit" : "";
  const eye = (x: number): string =>
    `<ellipse class="avatar-eye${lit}" cx="${x}" cy="${face.ey}" rx="4.8" ry="5.4"/>`;
  const eyes = `<g class="avatar-eyes">${custom.eyes ?? eye(50 - face.ex) + eye(50 + face.ex)}</g>`;
  const { mw: w, my: y } = face;
  const mouth = (kind: string, d: string, fill: boolean): string =>
    `<path class="avatar-mouth avatar-${kind}${fill ? " avatar-fill" : ""}" d="${d}"/>`;
  const mouths = custom.mouths
    ? mouth("smile", custom.mouths.smile, true) +
      mouth("open", custom.mouths.open, true) +
      mouth("frown", custom.mouths.frown, true) +
      mouth("flat", custom.mouths.flat, false)
    : mouth("smile", `M${50 - w} ${y} Q50 ${y + 13} ${50 + w} ${y}`, false) +
      mouth("open", `M${50 - w} ${y - 2} Q50 ${y + 20} ${50 + w} ${y - 2}Z`, true) +
      mouth("frown", `M${50 - w} ${y + 7} Q50 ${y - 6} ${50 + w} ${y + 7}`, false) +
      mouth("flat", `M${50 - w * 0.7} ${y + 3} H${50 + w * 0.7}`, false);
  return `<g>${eyes}${mouths}</g>`;
}

/** The two props a tap can bring out (hidden until a play shows them): a waving hand and binoculars. */
const HAND =
  '<g class="avatar-hand"><path class="avatar-arm" d="M82 68 Q104 66 102 40"/><circle class="avatar-palm" cx="102" cy="33" r="9"/></g>';

function scopeMarkup(shape: Shape): string {
  const { ey, ex } = shape.face ?? GENERIC;
  const dx = Math.max(ex, 12);
  const barrel = (x: number): string =>
    `<rect class="avatar-barrel" x="${x - 11}" y="${ey - 10}" width="22" height="20" rx="7"/><circle class="avatar-lens" cx="${x}" cy="${ey}" r="6"/>`;
  return `<g class="avatar-scope">${barrel(50 - dx)}${barrel(50 + dx)}<rect class="avatar-barrel" x="46" y="${ey - 3}" width="8" height="6"/></g>`;
}

let clips = 0;

/**
 * The shape as an inline SVG: body, texture clipped to the body, the shape's own art, a face with every
 * mouth (the CSS shows the one that data-face names) and the spark. Each call has its own clip id, so
 * a page may draw any number of avatars.
 */
export function avatarMarkup(id: string): string {
  const shape = Object.hasOwn(AVATAR_SHAPES, id) ? AVATAR_SHAPES[id] : AVATAR_SHAPES.cookie;
  if (!shape) return "";
  const clip = `avatar-clip-${++clips}`;
  const bodies = shape.parts
    .filter((part) => part.tone === "body")
    .map(
      (part) =>
        `<${part.tag} ${part.attrs}${part.transform ? ` transform="${part.transform}"` : ""}/>`,
    )
    .join("");
  const texture = `<clipPath id="${clip}">${bodies}</clipPath><g clip-path="url(#${clip})"><g class="avatar-dots">${DOTS}</g><g class="avatar-speck">${SPECK}</g></g>`;
  const stitch = shape.stitch ? `<path class="avatar-stitch" d="${shape.stitch}"/>` : "";
  return `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false"><g class="avatar-rig">${HAND}${shape.parts.map(partMarkup).join("")}${texture}${stitch}${shape.extras ?? ""}${faceMarkup(shape)}${scopeMarkup(shape)}<path class="avatar-spark" d="${SPARK}"/></g></svg>`;
}

/** The words of a mood's list token (--av-shapes, --av-plays): its text without the quotes. */
export function tokenWords(token: string): string[] {
  return token.replace(/["']/g, "").trim().split(/\s+/).filter(Boolean);
}

/** The shape ids a mood offers, from its --av-shapes token's text, keeping only shapes that exist. */
export function moodShapes(token: string): string[] {
  return tokenWords(token).filter((id) => Object.hasOwn(AVATAR_SHAPES, id));
}
