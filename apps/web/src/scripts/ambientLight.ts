import {
  backingSize,
  DRIFT_SECONDS,
  FRAME_MS,
  type FrameGate,
  paletteUniforms,
  shouldAnimate,
} from "./ambientPalette";

/**
 * The ambient cover light: one full-screen triangle and a fragment shader that mixes the cover's
 * colors through two octaves of warped value noise. The canvas is tiny and CSS scales it up, which
 * is the blur. It draws only while the header is on screen and the tab is visible, and it leaves
 * the CSS layer underneath in place whenever WebGL, the context or the shader is missing.
 */

const VERT = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 r;uniform float t;uniform vec3 c[3];
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
return mix(mix(h(i),h(i+vec2(1.,0.)),f.x),mix(h(i+vec2(0.,1.)),h(i+1.),f.x),f.y);}
float v(vec2 p){return .65*n(p)+.35*n(p*2.1+7.3);}
void main(){
vec2 u=gl_FragCoord.xy/r;vec2 p=u*vec2(r.x/r.y,1.)*1.2;
vec2 d=vec2(cos(t),sin(t))*.7;
vec2 q=vec2(v(p+d),v(p+4.1-d.yx));
float f=v(p+1.6*(q-.5));
vec3 k=mix(c[0],c[1],.55*smoothstep(.35,.75,f));
k=mix(k,c[2],.4*smoothstep(.5,.9,v(p*.8+q)));
float a=(.5+.5*smoothstep(.25,.75,f))*mix(.5,1.,smoothstep(.9,0.,length((u-vec2(.36,.6))*vec2(r.x/r.y,1.))));
float z=(h(gl_FragCoord.xy+fract(t))-.5)/255.;
gl_FragColor=vec4(k*a+z,a+z);}`;

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
    r: gl.getUniformLocation(program, "r"),
    t: gl.getUniformLocation(program, "t"),
    c: gl.getUniformLocation(program, "c"),
  };
}

function teardown() {
  live?.stop();
  live = undefined;
}

export function mountAmbient(host: HTMLElement) {
  if (live?.host === host && host.isConnected) return;
  teardown();
  const canvas = host.querySelector("canvas");
  if (!canvas || !host.isConnected) return;
  const gl = canvas.getContext("webgl", {
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
    powerPreference: "low-power",
  });
  if (!gl) return;

  const sets = (host.dataset.ambient ?? "").split(",");
  const light = paletteUniforms(sets.slice(0, 3));
  const dark = paletteUniforms(sets.slice(3));
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

  const draw = (now: number) => {
    if (!program || lost) return;
    const turn = (((now - t0) / 1000 + 9) % DRIFT_SECONDS) / DRIFT_SECONDS;
    gl.uniform2f(program.r, canvas.width, canvas.height);
    gl.uniform1f(program.t, turn * Math.PI * 2);
    gl.uniform3fv(program.c, isDark() ? dark : light);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    host.dataset.live = "";
  };

  const loop = (now: number) => {
    frame = requestAnimationFrame(loop);
    if (now - last < FRAME_MS) return;
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

  const size = () => {
    const [w, h] = backingSize(host.clientWidth, host.clientHeight);
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
    if (!frame) draw(t0);
  };

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
  seen.observe(host);
  sized.observe(host);

  live = {
    host,
    stop: () => {
      cancelAnimationFrame(frame);
      frame = 0;
      seen.disconnect();
      sized.disconnect();
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      document.removeEventListener("visibilitychange", onVisibility);
      motionQuery.removeEventListener("change", sync);
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
