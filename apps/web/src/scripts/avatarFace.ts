/**
 * A tap's show, played on the avatar's face (D353). A show is a few beats on a handful of channels (where
 * the eyes look, how open the lids are, a cheek that lifts into a happy squint, how wide the eyes go,
 * the mouth's smile, grin and o, the body's tilt and lift); one frame loop draws them. The eyes lead,
 * the body follows a stagger later, and every beat takes its length and its spring from the tokens
 * (motion spec, Calm by default: the 1.5% spatial springs and the effects springs).
 *
 * A morph flows the outline itself: both shapes' outlines are sampled into rings of the same number of
 * points, and a path in the body's tone runs from one to the other on the default spatial spring while
 * the face glides to the new shape's place and the colours mix (in oklab, so a mix never swings
 * through a third hue). Details that are not the outline (a stem, wings, whiskers, dots) fade out before
 * and back in after. The drawn shape changes under a blink halfway.
 */
import {
  AVATAR_SHAPES,
  avatarParts,
  rootStyle,
  shapeFace,
  shapeOutline,
  tokenMs,
} from "../design-system/avatar";
import {
  alignRing,
  type Beat,
  channelValue,
  lerpRing,
  mouthPath,
  type Point,
  parseStops,
  ringPath,
} from "./avatarMotion";

const REST = {
  look: 0,
  lid: 1,
  cheek: 0,
  wide: 1,
  smile: 1,
  open: 0,
  round: 0,
  tilt: 0,
  lift: 0,
  fade: 1,
  glide: 0,
  morph: 0,
  veil: 0,
};
type Channel = keyof typeof REST;
type Values = Record<Channel, number>;
type Script = {
  beats: Partial<Record<Channel, Beat[]>>;
  end: number;
  events: [number, () => void][];
};

const RING = 96;

/** The beats and lengths every show is made of, read from the tokens once per show. */
function kit() {
  const ease = (name: string): number[] => parseStops(rootStyle(`--ease-spring-${name}`));
  const t = {
    stagger: tokenMs("--duration-stagger"),
    move: tokenMs("--duration-spring-spatial-default"),
    slow: tokenMs("--duration-spring-spatial-slow"),
    fade: tokenMs("--duration-spring-effects-default"),
    fadeSlow: tokenMs("--duration-spring-effects-slow"),
    blink: tokenMs("--duration-avatar-blink"),
    hold: tokenMs("--duration-state"),
  };
  const e = {
    move: ease("spatial-default"),
    slow: ease("spatial-slow"),
    fade: ease("effects-default"),
    fadeSlow: ease("effects-slow"),
  };
  const script: Script = { beats: {}, end: 0, events: [] };
  const beat = (ch: Channel, at: number, to: number, dur: number, curve: number[]): void => {
    const list = script.beats[ch] ?? [];
    list.push({ at, to, dur, ease: curve });
    script.beats[ch] = list;
    script.end = Math.max(script.end, at + dur);
  };
  /** The eyes shut and open again, shut at `at`. */
  const blink = (at: number): void => {
    beat("lid", at - t.blink / 2, 0.08, t.blink / 2, e.fade);
    beat("lid", at, 1, t.blink / 2, e.fade);
  };
  return { t, e, script, beat, blink };
}

/** Glances left, then right, then home, the body a stagger behind, and a blink to end. */
function look(): Script {
  const { t, e, script, beat, blink } = kit();
  const leg = t.move + t.stagger;
  [-1, 1, 0].forEach((to, i) => {
    beat("look", i * leg, to, t.move, e.move);
    beat("tilt", i * leg + t.stagger, to * 3, t.move, e.move);
  });
  beat("smile", t.stagger, 0.6, t.fade, e.fade);
  beat("smile", 2 * leg + t.stagger, 1, t.fade, e.fade);
  blink(2 * leg + t.move + t.blink / 2);
  return script;
}

/** A happy squint: the cheeks lift over the eyes, the smile widens into a grin, the body rises a little. */
function happy(): Script {
  const { t, e, script, beat } = kit();
  beat("cheek", 0, 1, t.move, e.move);
  beat("smile", t.stagger, 1.35, t.move, e.move);
  beat("open", t.stagger, 0.4, t.move, e.move);
  beat("lift", 2 * t.stagger, -2, t.slow, e.slow);
  beat("tilt", 2 * t.stagger, 3, t.slow, e.slow);
  const back = t.slow + 2 * t.stagger + t.hold;
  beat("cheek", back, 0, t.move, e.move);
  beat("smile", back + t.stagger, 1, t.move, e.move);
  beat("open", back + t.stagger, 0, t.move, e.move);
  beat("lift", back + 2 * t.stagger, 0, t.slow, e.slow);
  beat("tilt", back + 2 * t.stagger, 0, t.slow, e.slow);
  return script;
}

/** Surprise: the eyes widen, the mouth rounds to an o, the body draws back; then all of it settles. */
function wow(): Script {
  const { t, e, script, beat, blink } = kit();
  beat("wide", 0, 1.22, t.move, e.move);
  beat("round", t.stagger, 1, t.move, e.move);
  beat("lift", 2 * t.stagger, -3, t.slow, e.slow);
  beat("tilt", 2 * t.stagger, -2, t.slow, e.slow);
  const back = t.slow + 2 * t.stagger + t.hold;
  beat("round", back, 0, t.move, e.move);
  beat("wide", back + t.stagger, 1, t.move, e.move);
  beat("lift", back + 2 * t.stagger, 0, t.slow, e.slow);
  beat("tilt", back + 2 * t.stagger, 0, t.slow, e.slow);
  blink(back + t.stagger + t.move + t.blink / 2);
  return script;
}

/** Halloween's boo: the body fades almost away with its eyes shut, then comes back wide-eyed with an o. */
function boo(): Script {
  const { t, e, script, beat } = kit();
  beat("fade", 0, 0.25, t.fadeSlow, e.fadeSlow);
  beat("lid", 0, 0.08, t.fade, e.fade);
  const back = t.fadeSlow + t.hold;
  beat("fade", back, 1, t.fadeSlow, e.fadeSlow);
  beat("lid", back, 1, t.fade, e.fade);
  beat("wide", back, 1.25, t.move, e.move);
  beat("round", back + t.stagger, 1, t.move, e.move);
  beat("lift", back + 2 * t.stagger, -3, t.slow, e.slow);
  const rest = back + t.move + t.hold;
  beat("round", rest, 0, t.move, e.move);
  beat("wide", rest + t.stagger, 1, t.move, e.move);
  beat("lift", rest + 2 * t.stagger, 0, t.slow, e.slow);
  return script;
}

interface Morph {
  from: string;
  to: string;
  a: Point[];
  b: Point[];
  body: [string, string];
  mark: [string, string];
}

let morphing: Morph | null = null;

/** A shape's outline as a ring, sampled by length on a path the browser measures. */
function ring(svg: SVGSVGElement, d: string): Point[] {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  svg.append(path);
  const length = path.getTotalLength();
  const points: Point[] = [];
  for (let i = 0; i < RING; i++) {
    const { x, y } = path.getPointAtLength((i / RING) * length);
    points.push([x, y]);
  }
  path.remove();
  return alignRing(points);
}

/** The two tones a shape wears (a ghost is ink and paper, a skull is stone), read as colours. */
function tones(id: string): [string, string] {
  const tone = AVATAR_SHAPES[id]?.tone;
  if (tone === "ink") return [rootStyle("--av-ink"), rootStyle("--av-paper")];
  if (tone === "stone") return [rootStyle("--scene-stone-lit"), rootStyle("--scene-iron-shade")];
  return [rootStyle("--av-body"), rootStyle("--av-mark")];
}

/** Flows to another shape and back home: there, a hold, and back, each change of drawing under a blink. */
function morph(svg: SVGSVGElement, from: string, to: string, swap: (id: string) => void): Script {
  const { t, e, script, beat, blink } = kit();
  const [bodyA, markA] = tones(from);
  const [bodyB, markB] = tones(to);
  morphing = {
    from,
    to,
    a: ring(svg, shapeOutline(from)),
    b: ring(svg, shapeOutline(to)),
    body: [bodyA, bodyB],
    mark: [markA, markB],
  };
  const leg = (at: number, target: number, id: string): number => {
    beat("veil", at, 1, t.fade, e.fade);
    beat("glide", at, target, t.move, e.move);
    beat("morph", at + t.stagger, target, t.move, e.move);
    // The drawing changes under a blink near the middle, where a spring has done half its travel.
    const swapAt = at + t.stagger + t.move * 0.35;
    blink(swapAt);
    script.events.push([swapAt, () => swap(id)]);
    const there = at + t.stagger + t.move;
    beat("veil", there, 0, t.fade, e.fade);
    return there;
  };
  const there = leg(0, 1, to);
  leg(there + t.move, 0, from);
  return script;
}

let frame = 0;
let started = 0;
let current: Script | null = null;

function value(ch: Channel, t: number): number {
  return channelValue(current?.beats[ch] ?? [], REST[ch], t);
}

type Styled = Element & ElementCSSInlineStyle;

function draw(avatar: HTMLElement, v: Values): void {
  const svg = avatar.querySelector("svg");
  const parts = svg && avatarParts(svg);
  const rig = parts?.rig;
  if (!svg || !parts || !rig) return;
  rig.style.rotate = `${v.tilt}deg`;
  rig.style.translate = `0 ${v.lift}px`;
  // How faded the body is (boo) and how hidden a morph keeps the details: avatar.css turns both into opacity.
  svg.style.setProperty("--av-fade", String(v.fade));
  svg.style.setProperty("--av-veil", String(v.veil));
  const own = shapeFace(avatar.dataset.shape ?? "");
  let face = own;
  if (morphing) {
    const a = shapeFace(morphing.from);
    const b = shapeFace(morphing.to);
    const mix = (k: "ey" | "ex" | "my" | "mw"): number => a[k] + (b[k] - a[k]) * v.glide;
    face = { ...own, ey: mix("ey"), ex: mix("ex"), my: mix("my"), mw: mix("mw") };
    const p = Math.min(1, Math.max(0, v.morph));
    const share = `${((1 - p) * 100).toFixed(1)}%`;
    svg.style.setProperty(
      "--av-body",
      `color-mix(in oklab, ${morphing.body[0]} ${share}, ${morphing.body[1]})`,
    );
    svg.style.setProperty(
      "--av-mark",
      `color-mix(in oklab, ${morphing.mark[0]} ${share}, ${morphing.mark[1]})`,
    );
    parts.blend()?.setAttribute("d", ringPath(lerpRing(morphing.a, morphing.b, v.morph)));
  }
  if (parts.face) parts.face.style.translate = `0 ${face.ey - own.ey}px`;
  if (parts.eyes) parts.eyes.style.translate = `${v.look * 3.5}px 0`;
  const spread = face.ex - own.ex;
  parts.eye.forEach((eye, i) => {
    eye.style.scale = `${v.wide} ${v.wide * v.lid}`;
    eye.style.translate = `${i ? spread : -spread}px 0`;
  });
  parts.cheek.forEach((cheek, i) => {
    cheek.style.display = v.cheek > 0.01 ? "inline" : "";
    cheek.style.translate = `${i ? spread : -spread}px ${-v.cheek * own.er * 1.1}px`;
  });
  if (parts.say) {
    parts.say.setAttribute(
      "d",
      mouthPath(face.my - (face.ey - own.ey), face.mw, v.smile, v.open, v.round),
    );
  } else {
    // A drawn mouth of its own (the pumpkin's grin) opens by scale.
    const grin = parts.smile;
    if (grin) grin.style.scale = `${1 - 0.2 * v.round} ${1 + 0.35 * v.open + 0.3 * v.round}`;
  }
}

function tick(avatars: () => HTMLElement[]): void {
  if (!current) return;
  const t = performance.now() - started;
  for (const event of current.events) {
    if (t >= event[0]) {
      event[1]();
      event[0] = Number.POSITIVE_INFINITY;
    }
  }
  const v = Object.fromEntries(
    (Object.keys(REST) as Channel[]).map((ch) => [ch, value(ch, t)]),
  ) as Values;
  for (const avatar of avatars()) draw(avatar, v);
  if (t < current.end) frame = requestAnimationFrame(() => tick(avatars));
}

/** Ends a show now and leaves every avatar as drawn, with no inline motion left on it. */
export function stopAct(avatars: HTMLElement[]): void {
  cancelAnimationFrame(frame);
  current = null;
  morphing = null;
  for (const avatar of avatars) {
    avatar.removeAttribute("data-act");
    avatarParts(avatar).blend(false)?.remove();
    for (const el of avatar.querySelectorAll<Styled>("svg, svg [style]"))
      el.removeAttribute("style");
  }
}

/**
 * Starts a show on every avatar and says how long it lasts. A morph needs the shape to flow to, and
 * `swap` draws a shape on every avatar.
 */
export function playAct(
  kind: string,
  avatars: () => HTMLElement[],
  home: string,
  other: string | undefined,
  swap: (id: string) => void,
): number {
  const first = avatars()[0]?.querySelector("svg");
  if (kind === "morph" && other && first) current = morph(first, home, other, swap);
  else current = ({ happy, wow, boo }[kind] ?? look)();
  for (const avatar of avatars()) avatar.dataset.act = kind;
  started = performance.now();
  tick(avatars);
  return current.end;
}
