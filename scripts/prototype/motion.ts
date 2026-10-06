/**
 * Motion helpers: token readers and a velocity-preserving spring.
 *
 * Why a hand-rolled spring: a gesture needs one thing CSS cannot do, which is to start an
 * animation at the finger's release velocity. The integrator is thirty lines and has no
 * dependency. In the production app, `motion`'s animate() with { type: "spring", duration, bounce,
 * velocity } is the equivalent; the parameters below map one to one.
 */

const root = (): CSSStyleDeclaration => getComputedStyle(document.documentElement);

export function readToken(name: string): string {
  return root().getPropertyValue(name).trim();
}

export function readNumberToken(name: string): number {
  return Number.parseFloat(readToken(name));
}

/** Reads a duration token such as "350ms" and returns seconds. */
export function readSecondsToken(name: string): number {
  const value = readToken(name);
  return value.endsWith("ms") ? Number.parseFloat(value) / 1000 : Number.parseFloat(value);
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface SpringSpec {
  /** Perceptual duration in seconds. The settle tail runs a little longer. */
  duration: number;
  /** 0 is critically damped. Apple damping ratio = 1 - bounce. */
  bounce: number;
}

/** Spring specs come from tokens, so a change in tokens.json changes the feel. */
export function springFromTokens(kind: "settle" | "release"): SpringSpec {
  const perceptualMs = kind === "settle" ? 350 : 400;
  return { duration: perceptualMs / 1000, bounce: readNumberToken(`--spring-${kind}-bounce`) };
}

export interface SpringRun {
  stop: () => void;
}

/**
 * Animates a scalar to a target with an optional initial velocity (units per second).
 * Mass 1, stiffness (2 pi / duration) squared, damping ratio 1 - bounce.
 */
export function runSpring(options: {
  from: number;
  to: number;
  velocity?: number;
  spec: SpringSpec;
  onUpdate: (value: number) => void;
  onRest: () => void;
}): SpringRun {
  const { to, spec, onUpdate, onRest } = options;
  let value = options.from;
  let velocity = options.velocity ?? 0;
  const omega = (2 * Math.PI) / spec.duration;
  const stiffness = omega * omega;
  const damping = 2 * (1 - spec.bounce) * omega;
  const step = 1 / 240;
  let carry = 0;
  let last = performance.now();
  let frame = 0;
  let stopped = false;

  const tick = (now: number): void => {
    if (stopped) return;
    // Clamp after a background tab so the spring does not jump to the end in one frame.
    carry += Math.min(0.05, (now - last) / 1000);
    last = now;
    while (carry >= step) {
      const acceleration = -stiffness * (value - to) - damping * velocity;
      velocity += acceleration * step;
      value += velocity * step;
      carry -= step;
    }
    const rest = Math.abs(value - to) < 0.0008 && Math.abs(velocity) < 0.02;
    if (rest) {
      onUpdate(to);
      onRest();
      return;
    }
    onUpdate(value);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return {
    stop() {
      stopped = true;
      cancelAnimationFrame(frame);
    },
  };
}

/** A plain eased tween, used where reduced motion replaces a spring with a short fade. */
export function runTween(options: {
  from: number;
  to: number;
  ms: number;
  onUpdate: (value: number) => void;
  onRest: () => void;
}): SpringRun {
  const start = performance.now();
  let frame = 0;
  let stopped = false;
  const tick = (now: number): void => {
    if (stopped) return;
    const t = Math.min(1, (now - start) / options.ms);
    const eased = 1 - (1 - t) ** 3;
    options.onUpdate(options.from + (options.to - options.from) * eased);
    if (t >= 1) options.onRest();
    else frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return {
    stop() {
      stopped = true;
      cancelAnimationFrame(frame);
    },
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
