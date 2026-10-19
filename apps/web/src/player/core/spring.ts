/**
 * A velocity-preserving spring, so a flick keeps its momentum when the sheet takes over.
 *
 * Why not CSS: a gesture needs the one thing a CSS curve cannot do, which is to start at the
 * finger's release velocity and to retarget from the live value. The integrator is small and has
 * no dependency. In `motion` the equivalent is animate(value, target, { type: "spring",
 * duration, bounce, velocity }); the parameters map one to one.
 *
 * Parameters (the retired design-spec.md, Springs): mass 1, stiffness (2 pi / duration)^2, damping ratio
 * 1 - bounce. `duration` is the perceptual duration; the settling tail runs a little longer.
 */
export interface SpringSpec {
  /** Perceptual duration in seconds. */
  duration: number;
  /** 0 is critically damped. Apple's damping ratio is 1 - bounce. */
  bounce: number;
}

export interface SpringState {
  value: number;
  /** Units per second. */
  velocity: number;
}

const SUBSTEP_SECONDS = 1 / 240;
/** A tab that was hidden for a second must not teleport the spring to its end in one frame. */
const MAX_FRAME_SECONDS = 0.05;
const REST_DISTANCE = 0.0008;
const REST_VELOCITY = 0.02;

/** Perceptual durations from the spec's spring table, in seconds. */
export const SPRING_DURATION_SECONDS = { settle: 0.35, release: 0.4 } as const;

export function springStep(
  state: SpringState,
  target: number,
  spec: SpringSpec,
  dtSeconds: number,
): SpringState {
  const omega = (2 * Math.PI) / spec.duration;
  const stiffness = omega * omega;
  const damping = 2 * (1 - spec.bounce) * omega;
  let { value, velocity } = state;
  let remaining = dtSeconds;
  while (remaining > 0) {
    const step = Math.min(SUBSTEP_SECONDS, remaining);
    velocity += (-stiffness * (value - target) - damping * velocity) * step;
    value += velocity * step;
    remaining -= step;
  }
  return { value, velocity };
}

export function isAtRest(state: SpringState, target: number): boolean {
  return Math.abs(state.value - target) < REST_DISTANCE && Math.abs(state.velocity) < REST_VELOCITY;
}

export interface SpringRun {
  stop(): void;
  /** Units per second right now, so whatever takes over can carry the motion on. */
  velocity(): number;
}

export interface SpringRunOptions {
  from: number;
  to: number;
  /** Units per second at the moment the spring takes over. */
  velocity?: number;
  spec: SpringSpec;
  onUpdate(value: number): void;
  onRest(): void;
  requestFrame?: (callback: (timestamp: number) => void) => number;
  cancelFrame?: (handle: number) => void;
}

export function runSpring(options: SpringRunOptions): SpringRun {
  const {
    to,
    spec,
    onUpdate,
    onRest,
    requestFrame = (callback) => requestAnimationFrame(callback),
    cancelFrame = (handle) => cancelAnimationFrame(handle),
  } = options;
  let state: SpringState = { value: options.from, velocity: options.velocity ?? 0 };
  let last: number | null = null;
  let handle = 0;
  let stopped = false;

  const tick = (timestamp: number): void => {
    if (stopped) return;
    const dt = last === null ? 1 / 60 : Math.min(MAX_FRAME_SECONDS, (timestamp - last) / 1000);
    last = timestamp;
    state = springStep(state, to, spec, dt);
    if (isAtRest(state, to)) {
      onUpdate(to);
      onRest();
      return;
    }
    onUpdate(state.value);
    handle = requestFrame(tick);
  };
  handle = requestFrame(tick);
  return {
    stop() {
      stopped = true;
      cancelFrame(handle);
    },
    velocity: () => (stopped ? 0 : state.velocity),
  };
}

/** An eased tween, used where reduced motion replaces a spring with a short fade. */
export function runTween(options: {
  from: number;
  to: number;
  durationMs: number;
  onUpdate(value: number): void;
  onRest(): void;
  requestFrame?: (callback: (timestamp: number) => void) => number;
  cancelFrame?: (handle: number) => void;
}): SpringRun {
  const {
    requestFrame = (callback) => requestAnimationFrame(callback),
    cancelFrame = (handle) => cancelAnimationFrame(handle),
  } = options;
  let start: number | null = null;
  let handle = 0;
  let stopped = false;
  const tick = (timestamp: number): void => {
    if (stopped) return;
    start ??= timestamp;
    const t = Math.min(1, (timestamp - start) / options.durationMs);
    // Cubic ease-out: the fade meets the finger, then settles.
    const eased = 1 - (1 - t) ** 3;
    options.onUpdate(options.from + (options.to - options.from) * eased);
    if (t >= 1) options.onRest();
    else handle = requestFrame(tick);
  };
  handle = requestFrame(tick);
  return {
    stop() {
      stopped = true;
      cancelFrame(handle);
    },
    // A fade has no momentum worth handing on.
    velocity: () => 0,
  };
}
