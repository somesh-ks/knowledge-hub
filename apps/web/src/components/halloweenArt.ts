/**
 * The Halloween style's empty-state scenes (D306): flat, rounded shapes on the kit's 240-unit scale, like
 * the Default ones, but drawn with their own subjects. Colours come only from classes that empty.css maps
 * to the `scene` tokens, so no raw colour, fill or stroke lives here. Decorative.
 */
const f = (n: number): number => Math.round(n * 100) / 100;

/** A crescent: the first circle with the second taken out of it, as one path. */
function crescent(x1: number, y1: number, r1: number, x2: number, y2: number, r2: number): string {
  const d = Math.hypot(x2 - x1, y2 - y1);
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(r1 * r1 - a * a);
  const px = x1 + (a * (x2 - x1)) / d;
  const py = y1 + (a * (y2 - y1)) / d;
  const ax = px + (h * (y2 - y1)) / d;
  const ay = py - (h * (x2 - x1)) / d;
  const bx = px - (h * (y2 - y1)) / d;
  const by = py + (h * (x2 - x1)) / d;
  return `M${f(ax)} ${f(ay)} A${r1} ${r1} 0 1 0 ${f(bx)} ${f(by)} A${r2} ${r2} 0 0 1 ${f(ax)} ${f(ay)}Z`;
}

/**
 * A glow with no visible edge: a radial gradient whose opacity eases out in five steps (a straight
 * two-stop fade reads as a disc). The steps are classes that empty.css scales from the theme's halo.
 */
function halo(id: string, cx: string, cy: string, tint: string): string {
  const stops = [
    [0, "sg"],
    [0.22, "sg-2"],
    [0.46, "sg-3"],
    [0.72, "sg-4"],
    [1, "sg-0"],
  ];
  return `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="50%">${stops
    .map(([offset, step]) => `<stop class="${tint} ${step}" offset="${offset}"/>`)
    .join("")}</radialGradient>`;
}

// ---------------------------------------------------------------- pumpkin
export function pumpkin(): string {
  // Five ribs, back to front. Each rib is an ellipse; the overlap draws the grooves.
  const rib = (cx: number, rx: number, ry: number, cy: number, fill: string): string =>
    `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" class="sf-${fill}"/>`;
  const groove = (cx: number, rx: number, ry: number, cy: number): string =>
    `<ellipse class="sn ss-pumpkin-shade" cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" stroke-width="1.4" opacity=".4"/>`;
  return `
  <defs>
    ${halo("sg-today", "50%", "52%", "sc-pumpkin-lit")}
    <clipPath id="sc-today"><path d="M120 51 C150 48 186 58 194 92 C200 124 168 148 120 148 C72 148 40 124 46 92 C54 58 90 48 120 51Z"/></clipPath>
  </defs>
  <ellipse cx="120" cy="92" rx="118" ry="78" class="sh-today a-breathe"/>
  <ellipse class="sf-ground" cx="120" cy="150" rx="66" ry="7" opacity=".9"/>
  <g clip-path="url(#sc-today)">
    <rect class="sf-pumpkin-shade" x="30" y="40" width="180" height="120"/>
    ${rib(70, 28, 46, 98, "pumpkin-shade")}
    ${rib(170, 28, 46, 98, "pumpkin-shade")}
    ${rib(92, 31, 49, 98, "pumpkin")}
    ${rib(148, 31, 49, 98, "pumpkin")}
    ${rib(120, 29, 50, 98, "pumpkin")}
    <ellipse class="sf-pumpkin-lit" cx="120" cy="98" rx="29" ry="50" opacity=".55"/>
    ${groove(92, 31, 49, 98)}${groove(148, 31, 49, 98)}${groove(120, 29, 50, 98)}
    <ellipse class="sf-glow" cx="108" cy="72" rx="12" ry="5" opacity=".22" transform="rotate(-18 108 72)"/>
    <path class="sf-pumpkin-shade" d="M44 120 C70 154 170 154 196 120 L196 160 L44 160Z" opacity=".5"/>
  </g>
  <ellipse class="sf-pumpkin-shade" cx="120" cy="57" rx="19" ry="5.5" opacity=".75"/>
  <!-- stem -->
  <path class="sf-stem" d="M110 58 C110 44 112 34 118 26 C122 21 130 21 133 26 C135 30 133 34 131 38 C129 44 129 52 130 58 C124 61 116 61 110 58Z"/>
  <path class="sn ss-pumpkin-lit" d="M118 26 C122 23 129 23 132 27" stroke-width="1.6" stroke-linecap="round" opacity=".5"/>
  <!-- tendril -->
  <path class="sn ss-stem" d="M105 56 C92 48 80 52 83 60 C85 66 94 64 93 58" stroke-width="2.6" stroke-linecap="round"/>
  <!-- face, carved through to the candle -->
  <g class="sf-glow ss-glow a-flicker" stroke-width="3.2" stroke-linejoin="round">
    <path d="M97 90 L117 90 L107 72Z"/>
    <path d="M123 90 L143 90 L133 72Z"/>
    <path d="M115 99 L125 99 L120 106Z"/>
  </g>
  <path class="sf-glow ss-glow" d="M90 108 C96 132 144 132 150 108 C142 116 130 118 120 118 C110 118 98 116 90 108Z" stroke-width="3" stroke-linejoin="round"/>
  <g class="sf-pumpkin-lit ss-pumpkin-lit" stroke-width="2" stroke-linejoin="round">
    <path d="M105 112 L113 113 L109 120Z"/>
    <path d="M127 113 L135 112 L131 120Z"/>
  </g>
  <path class="sn ss-moon" d="M104 83 L108 78 L112 83" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" opacity=".0"/>`;
}

// ---------------------------------------------------------------- ghost with a magnifier
export function ghost(): string {
  return `
  <ellipse class="sf-ground" cx="108" cy="146" rx="46" ry="6"/>
  <g class="a-bob">
  <path class="sf-bone ss-line" d="M62 140 L62 78 C62 46 82 28 108 28 C134 28 154 46 154 78 L154 140 C148 134 143 134 138 140 C133 146 128 146 123 140 C118 134 113 134 108 140 C103 146 98 146 93 140 C88 134 83 134 78 140 C73 146 68 146 62 140Z" stroke-width="1.6" stroke-linejoin="round"/>
  <path class="sf-bone-shade" d="M154 78 C154 46 134 28 108 28 C126 38 138 56 138 82 L138 134 C142 136 145 135 148 138 C150 139 152 139 154 140Z" opacity=".6"/>
  <!-- the arm that is not holding anything -->
  <path class="sf-bone ss-line" d="M63 98 C52 98 46 106 51 114 C55 119 62 115 64 109" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>
  <ellipse class="sf-iron" cx="92" cy="74" rx="6.5" ry="9"/>
  <ellipse class="sf-bone" cx="90.2" cy="70.5" rx="2" ry="2.8" opacity=".85"/>
  <ellipse class="sf-iron" cx="108" cy="104" rx="5" ry="6.4"/>
  <ellipse class="sf-pumpkin-lit" cx="83" cy="96" rx="6.4" ry="3.6" opacity=".4"/>
  <!-- magnifier, held by the right arm -->
  <path class="ss-stem" d="M147 96 L172 152" stroke-width="9" stroke-linecap="round"/>
  <path class="sf-bone ss-line" d="M150 128 C150 120 158 114 166 118 C170 121 168 128 162 130 C158 132 152 132 150 128Z" stroke-width="1.6" stroke-linejoin="round"/>
  <circle class="sf-pumpkin" cx="128" cy="76" r="26"/>
  <circle class="sf-bone" cx="128" cy="76" r="20.5" opacity=".94"/>
  <!-- the lens magnifies the right eye, so it sits on the same line as the left one (y 74) -->
  <ellipse class="sf-iron" cx="126" cy="76" rx="8" ry="11"/>
  <ellipse class="sf-bone" cx="123.6" cy="71.6" rx="2.5" ry="3.4" opacity=".9"/>
  <path class="sn ss-bone" d="M114 66 A17 17 0 0 1 124 59.6" stroke-width="3.2" stroke-linecap="round" opacity=".95"/>
  <circle class="sn ss-pumpkin-lit" cx="128" cy="76" r="26" stroke-width="1.6" opacity=".6"/>
  </g>
  <g class="sf-pumpkin-lit a-twinkle">
    <path d="M196 42 l2.2 6 6 2.2 -6 2.2 -2.2 6 -2.2 -6 -6 -2.2 6 -2.2z" opacity=".9"/>
    <path d="M34 52 l1.6 4.2 4.2 1.6 -4.2 1.6 -1.6 4.2 -1.6 -4.2 -4.2 -1.6 4.2 -1.6z" opacity=".7"/>
  </g>`;
}

// ---------------------------------------------------------------- cauldron
export function cauldron(): string {
  return `
  <defs>
    ${halo("sg-library", "50%", "40%", "sc-pumpkin-lit")}
    <clipPath id="sc-library"><path d="M54 78 C50 118 70 146 120 146 C170 146 190 118 186 78Z"/></clipPath>
  </defs>
  <ellipse cx="120" cy="86" rx="112" ry="72" class="sh-library a-breathe"/>
  <ellipse class="sf-ground" cx="120" cy="152" rx="70" ry="6"/>
  <!-- legs -->
  <path class="ss-iron-shade" d="M78 138 L70 152 M162 138 L170 152" stroke-width="9" stroke-linecap="round"/>
  <!-- bowl -->
  <path class="sf-iron" d="M54 78 C50 118 70 146 120 146 C170 146 190 118 186 78Z"/>
  <g clip-path="url(#sc-library)">
    <path class="sf-iron-shade" d="M150 70 C176 80 188 118 150 144 L190 150 L196 70Z"/>
    <path class="sn ss-iron-lit" d="M62 92 C62 116 76 134 96 140" stroke-width="4" stroke-linecap="round" opacity=".8"/>
  </g>
  <!-- the brew, seen over the rim -->
  <ellipse class="sf-iron-shade" cx="120" cy="78" rx="68" ry="15"/>
  <ellipse class="sf-pumpkin" cx="120" cy="79" rx="60" ry="10.5"/>
  <ellipse class="sf-pumpkin-lit" cx="120" cy="77.4" rx="52" ry="7.2"/>
  <path class="sn ss-iron-lit" d="M52 78 C52 70 80 62 120 62 C160 62 188 70 188 78" stroke-width="5" stroke-linecap="round"/>
  <!-- steam and bubbles -->
  <g class="sf-pumpkin-lit a-rise">
    <circle cx="96" cy="60" r="7"/>
    <circle cx="112" cy="40" r="4.5" opacity=".9"/>
    <circle cx="146" cy="56" r="5.5" opacity=".9"/>
    <circle cx="134" cy="32" r="3" opacity=".7"/>
    <circle cx="88" cy="36" r="2.6" opacity=".6"/>
  </g>
  <g class="sn ss-glow" stroke-width="1.6" stroke-linecap="round" opacity=".7">
    <path d="M93 58 A4.6 4.6 0 0 1 97 55"/>
    <path d="M144 54 A3.6 3.6 0 0 1 147 52.4"/>
  </g>
  <!-- a plus in the biggest bubble: add to the cauldron -->
  <g class="sn ss-stem" stroke-width="2.6" stroke-linecap="round" opacity=".0"><path d="M96 56v8M92 60h8"/></g>
  <path class="sf-pumpkin-lit a-twinkle" d="M170 44 l2 5.4 5.4 2 -5.4 2 -2 5.4 -2 -5.4 -5.4 -2 5.4 -2z" opacity=".85"/>`;
}

// ---------------------------------------------------------------- bat
function batShape(
  cx: number,
  cy: number,
  s = 1,
  fill = "iron",
  shade = "iron-shade",
  eyes = true,
): string {
  const t = (x: number, y: number): string => `${f(cx + x * s)} ${f(cy + y * s)}`;
  const wing = (m: number): string => {
    // right wing; m = 1 right, -1 left (mirrored)
    const p = (x: number, y: number): string => t(m * x, y);
    return `M${p(6, -4)} C${p(18, -18)} ${p(40, -26)} ${p(62, -16)} C${p(56, -10)} ${p(54, -6)} ${p(56, 0)} C${p(48, -4)} ${p(42, -2)} ${p(42, 6)} C${p(34, 0)} ${p(26, 2)} ${p(24, 12)} C${p(18, 4)} ${p(10, 4)} ${p(6, 10)}Z`;
  };
  return `
  <path d="${wing(1)}" class="sf-${fill} ss-${fill}" stroke-width="${f(2 * s)}" stroke-linejoin="round"/>
  <path d="${wing(-1)}" class="sf-${fill} ss-${fill}" stroke-width="${f(2 * s)}" stroke-linejoin="round"/>
  <path class="sn ss-${shade}" d="M${t(10, -2)} C${t(26, -14)} ${t(40, -18)} ${t(52, -13)} M${t(-10, -2)} C${t(-26, -14)} ${t(-40, -18)} ${t(-52, -13)}" stroke-width="${f(1.3 * s)}" stroke-linecap="round" opacity=".8"/>
  <path d="M${t(-6, -12)} L${t(-6, -22)} L${t(-1.5, -15)} L${t(1.5, -15)} L${t(6, -22)} L${t(6, -12)} C${t(8, 0)} ${t(5, 14)} ${t(0, 16)} C${t(-5, 14)} ${t(-8, 0)} ${t(-6, -12)}Z" class="sf-${fill} ss-${fill}" stroke-width="${f(2 * s)}" stroke-linejoin="round"/>
  ${eyes ? `<circle class="sf-pumpkin-lit" cx="${f(cx - 2.6 * s)}" cy="${f(cy - 8 * s)}" r="${f(1.4 * s)}"/><circle class="sf-pumpkin-lit" cx="${f(cx + 2.6 * s)}" cy="${f(cy - 8 * s)}" r="${f(1.4 * s)}"/>` : ""}`;
}

// Offline: a bat roosting under a branch, wings folded, a thin moon beyond.
export function batOffline(): string {
  return `
  <defs>
    ${halo("sg-offline", "50%", "50%", "sc-moon")}
  </defs>
  <circle cx="176" cy="68" r="58" class="sh-offline a-breathe" opacity=".6"/>
  <path class="sf-moon" d="${crescent(176, 68, 30, 192, 60, 29)}"/>
  <g class="sf-pumpkin-lit a-twinkle">
    <path d="M52 56 l1.8 4.8 4.8 1.8 -4.8 1.8 -1.8 4.8 -1.8 -4.8 -4.8 -1.8 4.8 -1.8z" opacity=".85"/>
    <circle cx="214" cy="116" r="1.8" opacity=".7"/><circle cx="36" cy="104" r="1.6" opacity=".6"/><circle cx="150" cy="44" r="1.6" opacity=".6"/>
  </g>
  <!-- branch -->
  <path class="sn ss-stem" d="M18 28 C70 22 130 32 222 24" stroke-width="9" stroke-linecap="round"/>
  <path class="sn ss-stem" d="M58 27 C62 17 72 12 82 13" stroke-width="4.2" stroke-linecap="round"/>
  <!-- the roosting bat: feet on the branch, wings wrapped round like a cloak, head tucked below -->
  <g class="a-sway">
  <path class="ss-iron-shade" d="M104 31 L116 31" stroke-width="6" stroke-linecap="round"/>
  <path class="sf-iron" d="M110 34 C97 44 84 70 90 98 C94 116 103 122 110 122 C117 122 126 116 130 98 C136 70 123 44 110 34Z"/>
  <path class="sf-iron-shade" d="M110 34 C123 44 136 70 130 98 C126 116 117 122 110 122 C121 112 124 80 110 34Z"/>
  <path class="sn ss-iron-lit" d="M110 44 C101 64 100 92 106 116" stroke-width="1.5" stroke-linecap="round" opacity=".75"/>
  <path class="sn ss-iron-lit" d="M96 84 C98 96 102 106 106 112" stroke-width="1.3" stroke-linecap="round" opacity=".5"/>
  <!-- head, ears pointing down because it hangs; eyes closed -->
  <path class="sf-iron-lit ss-iron-lit" d="M100 124 L96 140 L108 130Z M120 124 L124 140 L112 130Z" stroke-width="2" stroke-linejoin="round"/>
  <ellipse class="sf-iron-lit" cx="110" cy="119" rx="12" ry="11"/>
  <path class="sn ss-iron-shade" d="M102.6 116 q3 3 6 0 M111.4 116 q3 3 6 0" stroke-width="1.5" stroke-linecap="round"/>
  <ellipse class="sf-iron-shade" cx="110" cy="124" rx="2" ry="1.4"/>
  </g>`;
}

// Online: the bat awake and flying across a full moon; a check badge, as the original scene had.
export function batOnline(): string {
  return `
  <defs>
    ${halo("sg-online", "50%", "50%", "sc-moon")}
  </defs>
  <circle cx="120" cy="82" r="92" class="sh-online a-breathe"/>
  <circle class="sf-moon" cx="120" cy="82" r="62"/>
  <g class="sf-moon-shade" opacity=".7">
    <circle cx="96" cy="62" r="9"/><circle cx="142" cy="104" r="12"/><circle cx="104" cy="112" r="5.5"/><circle cx="148" cy="60" r="4"/>
  </g>
  <path class="sf-moon-shade" d="M120 20 A62 62 0 0 1 120 144 A46 62 0 0 0 120 20Z" opacity=".3"/>
  <g class="a-float">${batShape(110, 86, 1.05)}</g>
  <g class="sf-pumpkin-lit a-twinkle">
    <path d="M38 40 l1.8 4.8 4.8 1.8 -4.8 1.8 -1.8 4.8 -1.8 -4.8 -4.8 -1.8 4.8 -1.8z" opacity=".85"/>
    <circle cx="206" cy="46" r="1.8" opacity=".7"/>
  </g>
  <circle class="sf-knock" cx="176" cy="136" r="21"/>
  <circle class="sf-pumpkin" cx="176" cy="136" r="17"/>
  <path class="sn ss-iron-shade" d="M168 136.4 l5.6 5.6 10.6 -11" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`;
}

// ---------------------------------------------------------------- tombstone
export function tombstone(): string {
  // A grass blade: a thin leaf from (x, y) leaning dx, rising h.
  const blade = (x: number, y: number, dx: number, h: number): string =>
    `<path d="M${x - 2.2} ${y} C${x - 1.6} ${y - h * 0.5} ${x + dx * 0.5} ${y - h * 0.85} ${x + dx} ${y - h} C${x + dx * 0.9} ${y - h * 0.5} ${x + 2.2} ${y - h * 0.3} ${x + 2.2} ${y}Z"/>`;
  return `
  <defs>
    <clipPath id="sc-notfound"><path d="M78 148 L78 66 C78 38 98 22 120 22 C142 22 162 38 162 66 L162 148Z"/></clipPath>
    ${halo("sg-notfound", "50%", "50%", "sc-pumpkin-lit")}
  </defs>
  <ellipse class="sf-ground" cx="120" cy="150" rx="82" ry="8"/>
  <path class="sf-stone" d="M78 148 L78 66 C78 38 98 22 120 22 C142 22 162 38 162 66 L162 148Z"/>
  <g clip-path="url(#sc-notfound)">
    <path class="sf-stone-shade" d="M138 20 C158 30 166 48 162 74 L162 150 L130 150 C142 110 144 60 138 20Z" opacity=".7"/>
    <path class="sn ss-stone-lit" d="M84 70 C84 44 100 30 120 30" stroke-width="3.4" stroke-linecap="round" opacity=".9"/>
  </g>
  <path class="sn ss-stone-shade" d="M90 140 L90 68 C90 48 104 36 120 36 C136 36 150 48 150 68 L150 140" stroke-width="2.4" stroke-linecap="round" opacity=".9"/>
  <path class="sn ss-stone-shade" d="M105 74 C105 60 114 56 121 56 C130 56 137 62 137 71 C137 81 125 83 122 93 L122 99" stroke-width="7.4" stroke-linecap="round" stroke-linejoin="round"/>
  <path class="sn ss-stone-lit" d="M105 74 C105 60 114 56 121 56 C130 56 137 62 137 71 C137 81 125 83 122 93 L122 99" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity=".5" transform="translate(-1.2 -1.4)"/>
  <circle class="sf-stone-shade" cx="122" cy="114" r="4.8"/>
  <path class="sn ss-stone-shade" d="M150 84 L142 93 L147 101 L139 111" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  <!-- earth, grass, a candle -->
  <path class="sf-stem" d="M48 150 C66 136 96 131 120 133 C146 131 174 136 192 150Z"/>
  <g class="sf-pumpkin-shade">${blade(66, 143, -7, 14)}${blade(72, 142, 2, 17)}${blade(78, 141, 8, 12)}${blade(164, 141, -7, 12)}${blade(170, 142, 0, 17)}${blade(176, 143, 8, 13)}</g>
  <circle cx="190" cy="122" r="22" class="sh-notfound a-breathe"/>
  <rect class="sf-bone ss-line" x="185.5" y="124" width="9" height="17" rx="2.4" stroke-width="1.2"/>
  <path class="sf-pumpkin-lit a-flame" d="M190 121.5 c-3.4 -4.2 -1.2 -8.6 0 -11 c1.2 2.4 3.4 6.8 0 11z"/>
  <path class="sf-glow a-flame" d="M190 120 c-1.2 -1.8 -.4 -3.8 0 -4.8 c.5 1 1.4 3 0 4.8z"/>`;
}

// ---------------------------------------------------------------- cobweb + spider
// Drawn for the top-left corner: spokes fan from (0,0); the capture threads sag toward the corner.
