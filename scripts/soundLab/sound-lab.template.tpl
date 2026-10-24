<!-- biome-ignore-all lint: generated file, see scripts/buildSoundLab.ts -->
<!-- biome-ignore-all format: generated file -->
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="{{THEME_LIGHT}}">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="{{THEME_DARK}}">
<meta name="robots" content="noindex, nofollow">
<meta name="description" content="Audition every Singularity interface sound, adjust volume and hear how sounds duck under narration.">
<title>Sound lab, Singularity</title>
<style>{{FONTS}}</style>
<style>{{TOKENS}}</style>
<style>{{FOUNDATIONS}}</style>
<style>{{PROTOTYPE}}</style>
<style>{{LAB}}</style>
</head>
<body>
<a class="skip-link" href="#main">Skip to the sounds</a>

<header class="site-header">
  <div class="site-header-inner page lab-page">
    <a class="wordmark" href="ui-prototype.html" aria-label="Singularity, open the UI prototype">{{MARK}}<span>Singularity</span></a>
    <nav class="site-actions" aria-label="Site">
      <a class="btn press" href="ui-prototype.html">UI prototype</a>
    </nav>
  </div>
</header>

<main class="page lab-page lab" id="main">
  <section class="lab-intro" aria-labelledby="labTitle">
    <h1 id="labTitle">Sound lab</h1>
    <p class="lab-lede">Fourteen sounds from one instrument: a felt-hammered wooden bar, tuned to D major pentatonic. Tap a card to hear it. A phone on silent plays nothing, which is correct.</p>
  </section>

  <section class="lab-section" aria-labelledby="listenTitle">
    <h2 class="section-title" id="listenTitle">Listening</h2>
    <div class="lab-panel">
      <div class="lab-volume">
        <label for="volume" class="lab-volume-label"><span>Master volume</span><span class="lab-volume-value num" id="volumeValue">80%</span></label>
        <input class="range" id="volume" type="range" min="0" max="1" step="0.05" value="0.8">
        <p class="setting-hint">Peaks stay at or below -13 dBFS at full volume. The slider uses a quadratic taper, so half is a quarter of the gain.</p>
      </div>
      <label class="setting-row">
        <span class="setting-text"><span>Narration is playing</span><span class="setting-hint">Sounds that bracket narration stay silent. The rest duck by the amount on their card.</span></span>
        <input class="switch" id="narrationSwitch" type="checkbox" role="switch">
      </label>
      <div class="lab-actions">
        <button class="btn-secondary press press-subtle" id="speakButton" type="button">Read a sample aloud</button>
        <button class="btn-primary press press-subtle" id="sessionButton" type="button">Play a typical session</button>
      </div>
      <p class="setting-hint" id="speechNote" role="status"></p>
      <p class="setting-hint" id="sessionNow" role="status"></p>
      <fieldset class="lab-theme">
        <legend class="sr-only">Theme</legend>
        <div class="segmented">
          <label><input type="radio" name="theme" value="system" checked><span>System</span></label>
          <label><input type="radio" name="theme" value="light"><span>Light</span></label>
          <label><input type="radio" name="theme" value="dark"><span>Dark</span></label>
        </div>
      </fieldset>
    </div>
  </section>

  <section class="lab-section" aria-labelledby="soundsTitle">
    <h2 class="section-title" id="soundsTitle">The sounds</h2>
    <div class="sound-grid" id="soundGrid"></div>
  </section>

  <section class="lab-section" aria-labelledby="mapTitle">
    <h2 class="section-title" id="mapTitle">Sound map</h2>
    <div id="mapTable"></div>
  </section>

  <section class="lab-section" aria-labelledby="ladderTitle">
    <h2 class="section-title" id="ladderTitle">One tuning</h2>
    <p class="lab-lede">Every resting pitch comes from D, E, F#, A and B. A pentatonic set has no clashing semitones, so overlapping sounds and runs of scrub ticks always sound consonant. Up means forward, on, open, start. Down means back, off, close.</p>
    <div id="ladder"></div>
  </section>

  <section class="lab-section" aria-labelledby="silentTitle">
    <h2 class="section-title" id="silentTitle">Silent on purpose</h2>
    <p class="lab-lede">Scrolling, link taps, hover, theme changes and keyboard navigation make no sound. They happen too often, and a sound that repeats all day becomes noise. At most <span id="polyphony">4</span> voices play at once.</p>
  </section>
</main>

<script>{{SCRIPT}}</script>
</body>
</html>
