/**
 * The pure half of the ambient cover light (ambientLight.ts draws it): which palette colours the
 * light uses, how they become shader uniforms, how strongly they tint the page, and when a frame
 * is worth drawing. No DOM, so it is tested without a browser.
 */

/** One full turn of the drift takes this many seconds. */
export const DRIFT_SECONDS = 48;
/** At most one frame in this many milliseconds; the loop skips the rest. */
export const FRAME_MS = 1000 / 30;
/** Long side of the backing store; CSS scales it up and the scaling is the blur. */
export const MAX_SIDE = 128;

/** "#rrggbb" as three 0 to 1 channels. */
export function hexToUnit(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** How far a color sits from grey. */
function spread(hex: string): number {
  const [r, g, b] = hexToUnit(hex);
  return Math.max(r, g, b) - Math.min(r, g, b);
}

/**
 * The three colors of the light, most colorful first, so a cover on a grey ground still lights the
 * page with its figure color. Takes ground, accent and the mid shade between them.
 */
export function ambientColors(
  ground: string,
  accent: string,
  shade: string,
): [string, string, string] {
  return spread(accent) > spread(ground) ? [accent, ground, shade] : [ground, accent, shade];
}

/** The nine floats the shader reads as three vec3 colors. */
export function paletteUniforms(colors: readonly string[]): Float32Array {
  const out = new Float32Array(9);
  for (let i = 0; i < 3; i += 1) out.set(hexToUnit(colors[i] ?? colors[0] ?? "#808080"), i * 3);
  return out;
}

/** What the browser paints for a layer of `color` at `alpha` over `surface`, per sRGB channel. */
export function blendTint(color: string, surface: string, alpha: number): string {
  const c = hexToUnit(color);
  const s = hexToUnit(surface);
  const channel = (i: number) =>
    Math.round((c[i] * alpha + s[i] * (1 - alpha)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

export interface FrameGate {
  /** The tab is visible. */
  visible: boolean;
  /** The header is on screen. */
  onScreen: boolean;
  /** No reduced motion, no data saver. */
  motionAllowed: boolean;
}

/** A frame is drawn only when someone can see it and has not asked for stillness. */
export function shouldAnimate(gate: FrameGate): boolean {
  return gate.visible && gate.onScreen && gate.motionAllowed;
}

/** Backing-store size for a header box: the long side is `MAX_SIDE`, never smaller than 1. */
export function backingSize(width: number, height: number): [number, number] {
  const scale = MAX_SIDE / Math.max(width, height, 1);
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}
