<!-- biome-ignore-all lint: generated file, see scripts/buildPrototype.ts -->
<!-- biome-ignore-all format: generated file -->
<!doctype html>
<html lang="en" data-view="home" data-player="closed" data-mini="hidden">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="{{THEME_LIGHT}}">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="{{THEME_DARK}}">
<meta name="robots" content="noindex, nofollow">
<meta name="description" content="High-fidelity prototype of the Dispatch reader and player. Sample content is invented.">
<title>Wednesday 7 October, Dispatch</title>
<style>{{FONTS}}</style>
<style>{{TOKENS}}</style>
<style>{{FOUNDATIONS}}</style>
<style>{{PROTOTYPE}}</style>
</head>
<body>
<a class="skip-link" href="#main">Skip to the briefing</a>

<header class="site-header">
  <div class="site-header-inner page">
    <a class="wordmark" id="wordmarkSlot" href="#/" aria-label="Dispatch, today's briefing"></a>
    <nav class="site-actions" aria-label="Site">
      <a class="btn press nav-archive" href="#/archive">Archive</a>
      <button class="btn press" id="openGenerate" type="button"><span id="generateIcon" aria-hidden="true"></span>Generate</button>
      <button class="icon-btn press" id="openSettings" type="button" aria-label="Settings" aria-haspopup="dialog"><span id="settingsIcon" aria-hidden="true"></span></button>
    </nav>
  </div>
</header>

<div class="banner-stack page" id="banners"></div>
<div class="shell page" id="shell"></div>

<div class="mini" id="mini" role="region" aria-label="Audio player"></div>

<dialog class="player" id="playerSheet" aria-label="Now playing"></dialog>
<dialog class="sheet" id="generateSheet" aria-labelledby="generateTitle"></dialog>
<dialog class="sheet" id="settingsSheet" aria-labelledby="settingsTitle"></dialog>

<div class="toast" id="toast" popover="manual" role="status"></div>

<div class="sr-only" id="liveA" aria-live="polite" aria-atomic="true"></div>
<div class="sr-only" id="liveB" aria-live="polite" aria-atomic="true"></div>

<noscript><p class="page">This page needs JavaScript to show the briefing.</p></noscript>
<script>{{SCRIPT}}</script>
</body>
</html>
