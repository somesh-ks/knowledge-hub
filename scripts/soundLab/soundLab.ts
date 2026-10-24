/**
 * Sound lab: audition every Singularity UI sound with the real engine.
 * The waveforms are drawn from the same offline renderer the tests measure, so the numbers on
 * each card are the numbers CI checks.
 */
import {
  createSoundEngine,
  installGestureUnlock,
  MAX_POLYPHONY,
  noteName,
  PENTATONIC_HZ,
  PITCH,
  type PlayOptions,
  peakToDbfs,
  RECIPES,
  recipeDurationMs,
  renderRecipe,
  SOUND_NAMES,
  type SoundName,
  type SoundRecipe,
  type ToneLayer,
  TRIGGERS,
} from "../../packages/sound/src/index.js";

const LABELS: Record<SoundName, string> = {
  play: "Play",
  pause: "Pause",
  itemNext: "Next item",
  itemPrev: "Previous item",
  scrubDetent: "Scrub detent",
  speedChange: "Speed change",
  sheetOpen: "Sheet open",
  sheetClose: "Sheet close",
  generateStart: "Generate started",
  generateDone: "Generate finished",
  error: "Error",
  toggleOn: "Switch on",
  toggleOff: "Switch off",
  digestEnd: "End of digest",
};

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
const STORAGE_KEY = "singularity-sound-lab";

interface LabState {
  volume: number;
  narrating: boolean;
  theme: "system" | "light" | "dark";
}

function loadState(): LabState {
  const fallback: LabState = { volume: 0.8, narrating: false, theme: "system" };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw
      ? { ...fallback, ...(JSON.parse(raw) as Partial<LabState>), narrating: false }
      : fallback;
  } catch {
    return fallback;
  }
}

const state = loadState();
const engine = createSoundEngine({
  // The lab exists to hear sounds, so the app-level default for reduced motion does not apply.
  isEnabled: () => true,
  getVolume: () => state.volume,
  isNarrationPlaying: () => state.narrating,
});
installGestureUnlock(engine);

function $(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element;
}

const esc = (value: string): string =>
  value.replace(
    /[&<>"]/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char,
  );

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Best effort.
  }
}

/* ------------------------------------------------------------------ facts about a recipe */

function noteLine(recipe: SoundRecipe): string {
  const tones = recipe.layers.filter(
    (layer): layer is ToneLayer => layer.kind === "tone" && layer.detuneCents === undefined,
  );
  if (recipe.name === "scrubDetent") return "D4 to A5, by position";
  if (recipe.name === "speedChange") return "F#4 to F#5, by speed";
  return tones.map((layer) => noteName(layer.frequencyHz)).join(" to ");
}

function narrationLine(recipe: SoundRecipe): string {
  return recipe.whileNarrating.mode === "skip"
    ? "Skipped"
    : `Ducked ${Math.abs(recipe.whileNarrating.gainDb)} dB`;
}

function measure(recipe: SoundRecipe) {
  const result = renderRecipe(recipe, { position: 0.5, rate: 1.25 });
  return {
    result,
    peakDb: peakToDbfs(result.peak),
    durationMs: Math.round(recipeDurationMs(recipe)),
  };
}

const measured = Object.fromEntries(
  SOUND_NAMES.map((name) => [name, measure(RECIPES[name])]),
) as Record<SoundName, ReturnType<typeof measure>>;

/* ------------------------------------------------------------------ markup */

function cardMarkup(name: SoundName): string {
  const recipe = RECIPES[name];
  const m = measured[name];
  const control =
    name === "scrubDetent"
      ? `<label class="lab-param"><span>Position</span><input class="range" type="range" min="0" max="1" step="0.01" value="0.5" data-param="position" aria-label="Scrub position"></label>`
      : name === "speedChange"
        ? `<fieldset class="lab-param"><legend class="sr-only">Playback speed</legend><div class="segmented lab-rates">${RATES.map(
            (rate) =>
              `<label><input type="radio" name="rate-${name}" value="${rate}" ${rate === 1.25 ? "checked" : ""}><span>${rate}x</span></label>`,
          ).join("")}</div></fieldset>`
        : "";
  return `
    <article class="sound-card" data-sound="${name}" ${recipe.signature ? "data-signature" : ""}>
      <button class="sound-hit press press-subtle" type="button" data-play="${name}" aria-describedby="status-${name}">
        <span class="sound-wave"><canvas aria-hidden="true"></canvas><span class="sweep" aria-hidden="true"></span></span>
        <span class="sound-head">
          <span class="sound-name">${LABELS[name]}${recipe.signature ? '<span class="sound-tag">Signature</span>' : ""}</span>
          <span class="sound-trigger">${esc(TRIGGERS[name])}</span>
        </span>
      </button>
      <dl class="sound-facts">
        <div><dt>Length</dt><dd>${m.durationMs} ms</dd></div>
        <div><dt>Pitch</dt><dd>${noteLine(recipe)}</dd></div>
        <div><dt>Peak</dt><dd>${m.peakDb.toFixed(1)} dBFS</dd></div>
        <div><dt>Under speech</dt><dd>${narrationLine(recipe)}</dd></div>
      </dl>
      ${control}
      <p class="sound-intent">${esc(recipe.intent)}</p>
      <p class="sound-status" id="status-${name}" role="status"></p>
    </article>`;
}

function tableMarkup(): string {
  return `
    <div class="table-scroll scroll-area" tabindex="0" role="region" aria-label="Sound map table">
      <table class="map-table">
        <thead><tr><th scope="col">Event</th><th scope="col">Sound</th><th scope="col">Length</th><th scope="col">Pitch</th><th scope="col">Peak</th><th scope="col">Under speech</th></tr></thead>
        <tbody>
          ${SOUND_NAMES.map((name) => {
            const recipe = RECIPES[name];
            const m = measured[name];
            return `<tr><th scope="row">${esc(TRIGGERS[name])}</th><td>${LABELS[name]}</td><td>${m.durationMs} ms</td><td>${noteLine(recipe)}</td><td>${m.peakDb.toFixed(1)} dBFS</td><td>${narrationLine(recipe)}</td></tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;
}

function ladderMarkup(): string {
  const usage = new Map<number, Set<string>>();
  for (const name of SOUND_NAMES) {
    for (const layer of RECIPES[name].layers) {
      if (layer.kind !== "tone" || layer.detuneCents !== undefined) continue;
      const set = usage.get(layer.frequencyHz) ?? new Set<string>();
      set.add(LABELS[name]);
      usage.set(layer.frequencyHz, set);
    }
  }
  return `
    <ol class="ladder" role="list">
      ${[...PENTATONIC_HZ]
        .sort((a, b) => a - b)
        .filter((hz) => hz <= PITCH.D6)
        .map((hz) => {
          const users = usage.get(hz);
          return `<li class="ladder-note" ${users ? "data-used" : ""}><span class="ladder-name">${noteName(hz)}</span><span class="ladder-users">${users ? [...users].join(", ") : "Unused"}</span></li>`;
        })
        .join("")}
    </ol>`;
}

function render(): void {
  $("soundGrid").innerHTML = SOUND_NAMES.map(cardMarkup).join("");
  $("mapTable").innerHTML = tableMarkup();
  $("ladder").innerHTML = ladderMarkup();
  requestAnimationFrame(drawAll);
}

/* ------------------------------------------------------------------ waveforms */

function cssColor(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function drawWave(canvas: HTMLCanvasElement, name: SoundName): void {
  const box = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(box.width * ratio));
  canvas.height = Math.max(1, Math.round(box.height * ratio));
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { samples } = measured[name].result;
  const { audibleMs } = measured[name].result;
  const sampleRate = measured[name].result.sampleRate;
  const visible = Math.min(samples.length, Math.ceil(((audibleMs + 12) / 1000) * sampleRate));
  const columns = Math.max(1, Math.floor(canvas.width / (2 * ratio)));
  const perColumn = visible / columns;
  const mid = canvas.height / 2;
  // One shared vertical scale across cards: 0.25 (-12 dBFS) is the full half-height.
  const scale = (mid * 0.92) / 0.25;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = cssColor("--color-track");
  ctx.fillRect(0, mid - ratio / 2, canvas.width, ratio);
  ctx.fillStyle = cssColor("--color-accent");
  for (let column = 0; column < columns; column += 1) {
    let low = 0;
    let high = 0;
    const start = Math.floor(column * perColumn);
    const end = Math.min(samples.length, Math.floor((column + 1) * perColumn) + 1);
    for (let i = start; i < end; i += 1) {
      const value = samples[i] ?? 0;
      if (value < low) low = value;
      if (value > high) high = value;
    }
    const x = column * 2 * ratio;
    const top = mid - high * scale;
    const bottom = mid - low * scale;
    ctx.fillRect(x, top, ratio * 1.4, Math.max(ratio, bottom - top));
  }
}

function drawAll(): void {
  for (const canvas of document.querySelectorAll<HTMLCanvasElement>(".sound-card canvas")) {
    const name = canvas.closest<HTMLElement>("[data-sound]")?.dataset.sound as
      | SoundName
      | undefined;
    if (name) drawWave(canvas, name);
  }
}

/* ------------------------------------------------------------------ playing */

function optionsFor(card: HTMLElement): PlayOptions {
  const position = card.querySelector<HTMLInputElement>('[data-param="position"]');
  const rate = card.querySelector<HTMLInputElement>('input[type="radio"]:checked');
  return {
    ...(position ? { position: Number(position.value) } : {}),
    ...(rate ? { rate: Number(rate.value) } : {}),
  };
}

function reasonFor(name: SoundName): string {
  const recipe = RECIPES[name];
  if (state.volume <= 0.001) return "Volume is zero.";
  if (document.hidden) return "The tab is hidden, and the engine never plays in the background.";
  if (state.narrating && recipe.whileNarrating.mode === "skip") {
    return "Skipped on purpose: this sound stays silent while narration plays.";
  }
  return "Dropped: it retriggers inside its quiet window, or audio is still unlocking. Tap again.";
}

function sweep(card: HTMLElement, name: SoundName): void {
  const element = card.querySelector<HTMLElement>(".sweep");
  if (!element) return;
  element.style.setProperty("--sweep-ms", `${Math.max(120, measured[name].result.audibleMs)}ms`);
  element.classList.remove("is-running");
  // Reading offsetWidth restarts the animation when the same card is tapped twice.
  void element.offsetWidth;
  element.classList.add("is-running");
}

function audition(name: SoundName, card: HTMLElement | null, options?: PlayOptions): boolean {
  const played = engine.play(name, options ?? (card ? optionsFor(card) : {}));
  if (card) {
    if (played) sweep(card, name);
    const status = card.querySelector<HTMLElement>(".sound-status");
    if (status) status.textContent = played ? "Played." : reasonFor(name);
  }
  return played;
}

/* ------------------------------------------------------------------ session */

interface SessionStep {
  at: number;
  name: SoundName;
  options?: PlayOptions;
  narrating?: boolean;
}

const SESSION: readonly SessionStep[] = [
  { at: 0, name: "sheetOpen" },
  { at: 700, name: "play", narrating: false },
  { at: 1500, name: "itemNext", narrating: true },
  { at: 2400, name: "itemNext" },
  { at: 3600, name: "scrubDetent", options: { position: 0.25 }, narrating: false },
  { at: 3860, name: "scrubDetent", options: { position: 0.4 } },
  { at: 4120, name: "scrubDetent", options: { position: 0.55 } },
  { at: 4800, name: "speedChange", options: { rate: 1.5 }, narrating: true },
  { at: 5900, name: "pause", narrating: false },
  { at: 6700, name: "toggleOff" },
  { at: 7200, name: "toggleOn" },
  { at: 8000, name: "generateStart" },
  { at: 9800, name: "generateDone" },
  { at: 11200, name: "error" },
  { at: 12400, name: "digestEnd" },
  { at: 13000, name: "sheetClose" },
];

let sessionTimers: number[] = [];

function stopSession(): void {
  for (const timer of sessionTimers) window.clearTimeout(timer);
  sessionTimers = [];
  const button = $("sessionButton");
  button.textContent = "Play a typical session";
  button.removeAttribute("data-running");
  state.narrating = ($("narrationSwitch") as HTMLInputElement).checked;
}

function runSession(): void {
  const button = $("sessionButton");
  if (button.dataset.running) {
    stopSession();
    return;
  }
  button.dataset.running = "true";
  button.textContent = "Stop the session";
  for (const step of SESSION) {
    sessionTimers.push(
      window.setTimeout(() => {
        if (step.narrating !== undefined) state.narrating = step.narrating;
        // The cue for play fires before narration begins; the cue for pause fires after it stops.
        audition(
          step.name,
          document.querySelector<HTMLElement>(`[data-sound="${step.name}"]`),
          step.options,
        );
        if (step.name === "play") state.narrating = true;
        $("sessionNow").textContent = `${LABELS[step.name]}: ${TRIGGERS[step.name]}`;
      }, step.at),
    );
  }
  sessionTimers.push(window.setTimeout(stopSession, 14000));
}

/* ------------------------------------------------------------------ narration sample */

function speakSample(): void {
  if (typeof speechSynthesis === "undefined") {
    $("speechNote").textContent =
      "This browser has no speech synthesis. Use the switch to simulate narration.";
    return;
  }
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(
    "Springlet two point oh retargets springs mid-flight, so interrupted drawers keep their velocity. Every transition is now a spring with a live target. A new gesture layer feeds a flick's momentum straight into the settle. Copy the retargeting pattern for drawers and toasts.",
  );
  utterance.lang = "en";
  utterance.onstart = () => setNarration(true);
  utterance.onend = () => setNarration(false);
  utterance.onerror = () => setNarration(false);
  speechSynthesis.speak(utterance);
}

function setNarration(on: boolean): void {
  state.narrating = on;
  const input = $("narrationSwitch") as HTMLInputElement;
  input.checked = on;
}

/* ------------------------------------------------------------------ wiring */

function applyTheme(): void {
  const root = document.documentElement;
  if (state.theme === "system") root.removeAttribute("data-theme");
  else root.dataset.theme = state.theme;
  requestAnimationFrame(drawAll);
}

function paintVolume(): void {
  const range = $("volume") as HTMLInputElement;
  range.value = String(state.volume);
  range.style.setProperty("--range-fill", `${state.volume * 100}%`);
  $("volumeValue").textContent = `${Math.round(state.volume * 100)}%`;
}

render();
paintVolume();
applyTheme();
(
  document.querySelector(`input[name="theme"][value="${state.theme}"]`) as HTMLInputElement | null
)?.setAttribute("checked", "");

document.addEventListener("click", (event) => {
  const button = (event.target as Element).closest<HTMLElement>("[data-play]");
  if (!button) return;
  const name = button.dataset.play as SoundName;
  audition(name, button.closest<HTMLElement>("[data-sound]"));
});

document.addEventListener("change", (event) => {
  const target = event.target as HTMLInputElement;
  if (target.id === "narrationSwitch") {
    state.narrating = target.checked;
    return;
  }
  if (target.name === "theme") {
    state.theme = target.value as LabState["theme"];
    save();
    applyTheme();
    return;
  }
  const card = target.closest<HTMLElement>("[data-sound]");
  if (card && target.name.startsWith("rate-")) audition(card.dataset.sound as SoundName, card);
});

document.addEventListener("input", (event) => {
  const target = event.target as HTMLInputElement;
  if (target.id === "volume") {
    state.volume = Number(target.value);
    save();
    paintVolume();
  }
  const card = target.closest<HTMLElement>("[data-sound]");
  if (card && target.dataset.param === "position") audition(card.dataset.sound as SoundName, card);
});

$("sessionButton").addEventListener("click", runSession);
$("speakButton").addEventListener("click", speakSample);
$("volume").addEventListener("change", () => audition("toggleOn", null));

window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", () => requestAnimationFrame(drawAll));
window.addEventListener("resize", () => requestAnimationFrame(drawAll));
$("polyphony").textContent = String(MAX_POLYPHONY);
