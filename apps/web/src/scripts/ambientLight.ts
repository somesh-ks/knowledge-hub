import {
  backingSize,
  DRIFT_SECONDS,
  FRAME_MS,
  type FrameGate,
  paletteUniforms,
  shouldAnimate,
} from "./ambientPalette";

/**
 * The ambient cover light: one full-screen triangle and a fragment shader that draws three round,
 * soft lights in the cover's colors: the main one behind the cover, the other two drifting beside it
 * toward the title. Slow warped noise bends their edges, so no light reads as a drawn circle. The
 * canvas is tiny and CSS scales it up, which is the blur. It draws only while the header is on
 * screen and the tab is visible, and it leaves the CSS layer underneath in place whenever WebGL, the
 * context or the shader is missing.
 */

const VERT = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";

// o is the cover in backing pixels: centre x, centre y from the bottom, side. Every term of t is a
// whole multiple of it, so the drift comes back to where it started and the loop has no seam.
const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform float t;uniform vec3 c[3];uniform vec3 o;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
return mix(mix(h(i),h(i+vec2(1.,0.)),f.x),mix(h(i+vec2(0.,1.)),h(i+1.),f.x),f.y);}
float g(vec2 p,vec2 at,float r){vec2 d=(p-at)/r;return exp(-dot(d,d));}
void main(){
float s=o.z;vec2 p=(gl_FragCoord.xy-o.xy)/s;
vec2 d=vec2(cos(t),sin(t));
p+=(vec2(n(p*1.4+d*1.2),n(p*1.4+5.2-d.yx*1.2))-.5)*.6;
float a=g(p,vec2(.12*cos(t),.1*sin(2.*t)),.8);
float b=g(p,vec2(1.05+.3*cos(t+2.1),.1+.2*sin(2.*t+1.)),.6);
float e=g(p,vec2(2.+.35*cos(t+4.2),.2*sin(3.*t+2.)),.55);
float m=a+b+e;
vec3 k=(c[0]*a+c[1]*b+c[2]*e)/max(m,1e-4);
float w=1.-exp(-1.6*m);
float z=(h(gl_FragCoord.xy+fract(t))-.5)/255.;
gl_FragColor=vec4(k*w+z,w+z);}`;

interface Live {
  host: HTMLElement;
  stop: () => void;
}

let live: Live | undefined;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

/** Program, triangle and uniform locations; null when anything fails. */
function build(gl: WebGLRenderingContext) {
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  const program = gl.createProgram();
  if (!vs || !fs || !program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  // biome-ignore lint/correctness/useHookAtTopLevel: WebGL useProgram, not a React hook
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const at = gl.getAttribLocation(program, "p");
  gl.enableVertexAttribArray(at);
  gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
  return {
    t: gl.getUniformLocation(program, "t"),
    c: gl.getUniformLocation(program, "c"),
    o: gl.getUniformLocation(program, "o"),
  };
}

function teardown() {
  live?.stop();
  live = undefined;
}

/**
 * A frame is due this long after the last one. Less than FRAME_MS on purpose: frame times jitter by
 * a millisecond or two, and a strict comparison would skip every third due frame on a 60Hz screen.
 */
const FRAME_DUE_MS = FRAME_MS - 4;

let onProcessor: boolean | undefined;

/**
 * True where WebGL would draw on the processor (Chromium's SwiftShader, Mesa's llvmpipe and
 * softpipe, Windows' basic render driver) or is missing. A decoration is not worth that: the CSS
 * layer is the light there. Asking for a context that may fail on a slow renderer is not enough,
 * since a headless Chromium grants its software one all the same, and then logs a warning for every
 * frame it has to read back. Asked once, of a canvas that is never shown, so the page's own canvas
 * is left untouched. A browser that hides the renderer's name is taken to have a GPU.
 */
function drawsOnProcessor(): boolean {
  if (onProcessor !== undefined) return onProcessor;
  const gl = document
    .createElement("canvas")
    .getContext("webgl", { failIfMajorPerformanceCaveat: true });
  if (!gl) {
    onProcessor = true;
    return onProcessor;
  }
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = String(
    info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
  );
  onProcessor = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer);
  return onProcessor;
}

export function mountAmbient(host: HTMLElement) {
  // This module loads on idle, so the page it was asked for may be gone by now. A header that has
  // left the document must not stop the light of the page that replaced it.
  if (!host.isConnected) return;
  if (live?.host === host) return;
  if (drawsOnProcessor()) return;
  teardown();
  const canvas = host.querySelector("canvas");
  if (!canvas) return;
  const gl = canvas.getContext("webgl", {
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    powerPreference: "low-power",
    // A browser that can tell this context would be slow may refuse it; drawsOnProcessor covers
    // the ones that grant it anyway.
    failIfMajorPerformanceCaveat: true,
  });
  if (!gl) return;

  // The colours of each style's cover (D311): Default's in data-ambient, a style's under its name.
  const byStyle: Record<string, string> = (() => {
    try {
      return JSON.parse(host.dataset.ambientStyles ?? "{}");
    } catch {
      return {};
    }
  })();
  const palettes = new Map<string, { light: Float32Array; dark: Float32Array }>();
  const paletteFor = (style: string) => {
    let held = palettes.get(style);
    if (!held) {
      const sets = (byStyle[style] ?? host.dataset.ambient ?? "").split(",");
      held = { light: paletteUniforms(sets.slice(0, 3)), dark: paletteUniforms(sets.slice(3)) };
      palettes.set(style, held);
    }
    return held;
  };
  const darkQuery = matchMedia("(prefers-color-scheme: dark)");
  const isDark = () => {
    const theme = document.documentElement.dataset.theme;
    return theme ? theme === "dark" : darkQuery.matches;
  };
  const motionQuery = matchMedia("(prefers-reduced-motion: reduce)");
  const dataQuery = matchMedia("(prefers-reduced-data: reduce)");
  const gate: FrameGate = { visible: !document.hidden, onScreen: true, motionAllowed: true };
  let program = build(gl);
  let frame = 0;
  let last = 0;
  let lost = false;
  const t0 = performance.now();
  // Where the light gathers: the header's cover, in backing pixels (see FRAG).
  const cover = new Float32Array(3);
  const measure = () => {
    const box = host.getBoundingClientRect();
    const art = host.parentElement?.querySelector(".cover")?.getBoundingClientRect();
    const scale = canvas.width / Math.max(box.width, 1);
    const shown = art && art.width > 0 ? art : undefined;
    const side = shown?.width ?? box.height / 2;
    const x = shown ? shown.left - box.left + side / 2 : box.height / 2;
    const y = shown ? shown.top - box.top + side / 2 : box.height / 2;
    cover.set([x * scale, (box.height - y) * scale, side * scale]);
  };

  const draw = (now: number) => {
    if (!program || lost) return;
    const turn = (((now - t0) / 1000 + 9) % DRIFT_SECONDS) / DRIFT_SECONDS;
    gl.uniform1f(program.t, turn * Math.PI * 2);
    gl.uniform3fv(program.o, cover);
    const colours = paletteFor(document.documentElement.dataset.style ?? "");
    gl.uniform3fv(program.c, isDark() ? colours.dark : colours.light);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    host.dataset.live = "";
  };

  const loop = (now: number) => {
    frame = requestAnimationFrame(loop);
    if (now - last < FRAME_DUE_MS) return;
    last = now;
    draw(now);
  };

  const sync = () => {
    const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
    gate.motionAllowed = !motionQuery.matches && !dataQuery.matches && !nav.connection?.saveData;
    if (shouldAnimate(gate) && !lost) {
      if (!frame) frame = requestAnimationFrame(loop);
    } else {
      cancelAnimationFrame(frame);
      frame = 0;
      // Stillness still gets one frame, so the light is there; it is just not moving.
      if (!gate.motionAllowed && gate.onScreen) draw(t0);
    }
  };

  /** One frame now: at the present moment where the light may move, at the still frame's otherwise. */
  const redraw = () => draw(gate.motionAllowed ? performance.now() : t0);

  const size = () => {
    const [w, h] = backingSize(host.clientWidth, host.clientHeight);
    // The header can change size while the backing store keeps its size: the light follows the cover.
    if (canvas.width === w && canvas.height === h) {
      measure();
      return;
    }
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
    measure();
    // Setting the size clears the canvas. The loop may skip its next frame, so draw here always;
    // otherwise a resize or a turned phone shows one empty frame.
    redraw();
  };

  // While the light is still (reduced motion, off screen, a hidden tab) nothing would repaint it in
  // the other theme's colours, and the CSS layer under it is hidden once the canvas is live.
  const themed = new MutationObserver(redraw);

  const onLost = (event: Event) => {
    event.preventDefault();
    lost = true;
    cancelAnimationFrame(frame);
    frame = 0;
    delete host.dataset.live;
  };
  const onRestored = () => {
    program = build(gl);
    lost = false;
    gl.viewport(0, 0, canvas.width, canvas.height);
    draw(t0);
    sync();
  };
  const onVisibility = () => {
    gate.visible = !document.hidden;
    sync();
  };

  const seen = new IntersectionObserver((entries) => {
    gate.onScreen = entries.at(-1)?.isIntersecting ?? true;
    sync();
  });
  const sized = new ResizeObserver(size);

  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);
  document.addEventListener("visibilitychange", onVisibility);
  motionQuery.addEventListener("change", sync);
  dataQuery.addEventListener("change", sync);
  darkQuery.addEventListener("change", redraw);
  themed.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "data-style"],
  });
  seen.observe(host);
  sized.observe(host);

  live = {
    host,
    stop: () => {
      cancelAnimationFrame(frame);
      frame = 0;
      seen.disconnect();
      sized.disconnect();
      themed.disconnect();
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      document.removeEventListener("visibilitychange", onVisibility);
      motionQuery.removeEventListener("change", sync);
      dataQuery.removeEventListener("change", sync);
      darkQuery.removeEventListener("change", redraw);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };

  size();
  if (!program) {
    teardown();
    return;
  }
  draw(t0);
  sync();
}

document.addEventListener("astro:before-swap", teardown);
