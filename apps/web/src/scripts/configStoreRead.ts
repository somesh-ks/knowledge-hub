/**
 * What the config store holds (D149), for a settings page built before it: GET /api/config answers
 * with the edits that turn the page's built copy into the stored config, and the sources a topic
 * page must draw. savedView.ts lays them over the page as it lays a just-saved edit, before the
 * editor reads its starting point, so an edit made on any device shows here, and a toggle sends
 * from what is stored, not from the build.
 *
 * Loaded only when the build says the store is on (storeOn, lib/savedKey.ts). The device keeps the
 * last answer it read (D172): a store that is slow (Neon waking), down or unreachable (offline)
 * answers from that copy after a short grace, so the page shows what this device last knew rather
 * than the build, which is a run old by design. A store that answers in time, or answers later, is
 * what the next read and the copy hold; one that answers after the page is drawn, with something
 * new, is offered in a toast as a reload (D173). With no copy, an outage costs freshness, never the
 * page.
 */
import type { ConfigOp, ConfigReadBody, StoreSource } from "../types/contracts";
import { sendToast } from "./toastEvent";

/** How long a page waits for the store before it keeps its built copy. */
export const STORE_READ_TIMEOUT_MS = 2500;
/** How long a read the page stopped waiting for may still answer, to offer what it found. */
const STORE_READ_LIMIT_MS = 20_000;

/** One read serves the scripts of one page view; a page opened a second later asks again. */
const REUSE_MS = 1000;
/** How long a page waits for the store before it shows the device's copy instead, when it has one. */
export const CACHE_GRACE_MS = 300;
/** Where the device keeps the last answer: one build's edits, checked against the page on read. */
export const CACHE_KEY = "singularity:store-read";

/** Where the device keeps the newest revision its own saves produced (the store's clock). */
export const OWN_KEY = "singularity:store-own-write";

/**
 * Keeps the revision a save of this device produced, so the store's answer holding it is not read as
 * another device's change (offerReload): only a write after it is.
 */
export function noteOwnWrite(writtenAt: number): void {
  try {
    localStorage.setItem(OWN_KEY, String(Math.max(writtenAt, ownWrite())));
  } catch {
    // A full or blocked storage only costs a toast that is not needed.
  }
}

function ownWrite(): number {
  try {
    const kept = Number(localStorage.getItem(OWN_KEY));
    return Number.isFinite(kept) ? kept : 0;
  } catch {
    return 0;
  }
}

/** True when the answer is no newer than this device's own latest save. */
const isOwn = (body: ConfigReadBody): boolean =>
  body.written_at !== null && body.written_at <= ownWrite();

let last: { at: number; read: Promise<ConfigReadBody | null> } | undefined;
let current: ConfigReadBody | null = null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Which config files this page was built from, as its config-store tag names them. */
function builtHere(): string | null {
  return (
    document.querySelector<HTMLMetaElement>('meta[name="singularity-config-store"]')?.content ??
    null
  );
}

function parseRead(body: unknown): ConfigReadBody | null {
  if (!isRecord(body) || body.status !== 200) return null;
  const { written_at: writtenAt, ops, sources, built } = body;
  if (!Array.isArray(ops) || !Array.isArray(sources)) return null;
  if (writtenAt !== null && typeof writtenAt !== "number") return null;
  // The edits are a diff from the files the answering deployment was built from. A page from
  // another build (a kept copy, a tab open across a deploy) keeps its own copy instead; the deploy
  // toast offers the current site.
  if (typeof built !== "string" || built !== builtHere()) return null;
  return {
    status: 200,
    built,
    written_at: writtenAt,
    ops: ops.filter((op): op is ConfigOp => isRecord(op) && typeof op.op === "string"),
    sources: sources.filter(
      (source): source is StoreSource =>
        isRecord(source) &&
        typeof source.id === "string" &&
        typeof source.page === "string" &&
        typeof source.name === "string",
    ),
  };
}

/** The device's copy of the last answer, when it is for this build; null otherwise. */
function readCache(): ConfigReadBody | null {
  try {
    return parseRead(JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null"));
  } catch {
    return null;
  }
}

/** The page's store value takes an answer unless the one it holds was written later. */
function adopt(body: ConfigReadBody): void {
  if (
    current?.written_at != null &&
    (body.written_at == null || body.written_at < current.written_at)
  ) {
    return;
  }
  current = body;
}

function writeCache(body: ConfigReadBody): void {
  // A read that started before a save can resolve after the post-save read: never write older over newer.
  const held = readCache();
  if (held?.written_at != null && (body.written_at == null || body.written_at < held.written_at)) {
    return;
  }
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(body));
  } catch {
    // A full or blocked storage only costs the next load its copy.
  }
}

/**
 * A save made here went through (written_at is the store's clock for it): the device's copy is a
 * write behind, so the store is asked again at once and the copy takes the answer. Another tab reads
 * the same copy on its next navigation, so it shows the edit without a reload. The ask carries its
 * own query so the edge's one-second cache cannot hand back the answer from before the save.
 */
export function afterOwnSave(): void {
  const asked = { at: 0 } as { at: number; read: Promise<ConfigReadBody | null> };
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), STORE_READ_TIMEOUT_MS * 2);
  asked.read = fetch(`/api/config?after=${Date.now()}`, {
    signal: stop.signal,
    headers: { Accept: "application/json" },
  })
    .then((response) => (response.ok ? response.json() : null))
    .then(parseRead)
    .catch(() => null)
    .then((body) => {
      clearTimeout(timer);
      // adopt() keeps a newer value, so a save's answer counts even after a later read started.
      if (body) adopt(body);
      if (body) writeCache(body);
      return body;
    });
  // Reads started before the save no longer speak for the store.
  last = asked;
}

/**
 * Asks the store, once per page view: the store's answer when it comes within the grace, else the
 * device's copy at once while the store is still asked; null when it is off, down, slow or
 * unreadable and the device has no copy.
 *
 * The page's regions the store can change (`[data-store-held]`, settings.css) wait, hidden, until
 * then: they show in the task after the answer, once the caller has laid it over them in the
 * microtasks that follow, so the build's values never paint first (2026-10-27, Podcast voice).
 */
export function loadStore(now = Date.now()): Promise<ConfigReadBody | null> {
  return askStore(now).then((body) => {
    setTimeout(showHeld, 0);
    return body;
  });
}

/** The held regions of the page now in the document, shown with whatever was laid over them. */
function showHeld(): void {
  if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") return;
  for (const region of document.querySelectorAll<HTMLElement>(
    "[data-store-held]:not([data-store-held=editor])",
  )) {
    region.dataset.storeApplied = "";
  }
}

function askStore(now: number): Promise<ConfigReadBody | null> {
  // A read reused within the second answers as storeRead does: for the page now in the document.
  if (last && now - last.at < REUSE_MS) return last.read.then(() => storeRead());
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), STORE_READ_LIMIT_MS);
  const asked = { at: now } as { at: number; read: Promise<ConfigReadBody | null> };
  const cached = readCache();
  asked.read = fetch("/api/config", {
    signal: stop.signal,
    headers: { Accept: "application/json" },
  })
    .then((response) => (response.ok ? response.json() : null))
    .then(parseRead)
    .catch(() => null)
    .then((body) => {
      clearTimeout(timer);
      // Only the newest read speaks for the store: an older one that ends late, or fails, does not
      // replace what a newer one found. A failed read leaves the device's copy standing.
      if (last === asked && body) adopt(body);
      if (body) writeCache(body);
      return body ?? (last === asked ? current : null);
    });
  last = asked;
  if (!cached) {
    // The page keeps its built copy after the wait; a store that answers later is offered.
    let late = false;
    void asked.read.then((body) => {
      if (late && body && !isOwn(body) && (body.ops.length > 0 || body.sources.length > 0))
        offerReload();
    });
    const wait = new Promise<null>((resolve) => {
      setTimeout(() => {
        late = true;
        resolve(null);
      }, STORE_READ_TIMEOUT_MS);
    });
    return Promise.race([asked.read, wait]);
  }
  // The copy stands until the store answers; a read that ends after the grace updates `current`
  // for whatever reads next, and the copy for the next page.
  if (current === null) current = cached;
  let settled = false;
  const fromStore = asked.read.then((body) => {
    settled = true;
    return body ?? cached;
  });
  const fromCache = new Promise<ConfigReadBody>((resolve) => {
    setTimeout(() => resolve(cached), CACHE_GRACE_MS);
  });
  return Promise.race([fromStore, fromCache]).then((body) => {
    // The page shows the copy: a store that answers after it, with something else, is offered.
    if (!settled)
      void asked.read.then((later) => {
        if (later && !isOwn(later) && sameEdits(later, cached) === false) offerReload();
      });
    return settled ? body : cached;
  });
}

const sameEdits = (a: ConfigReadBody, b: ConfigReadBody): boolean =>
  JSON.stringify([a.ops, a.sources]) === JSON.stringify([b.ops, b.sources]);

/**
 * A store answer that came after the page was drawn: the editors have read their starting point, so
 * the page is not redrawn under the reader. The toast offers a reload, which shows it.
 */
function offerReload(): void {
  const up = (): boolean => {
    try {
      return document.querySelector(".toast:popover-open") !== null;
    } catch {
      return false;
    }
  };
  sendToast(
    {
      message: "Settings changed on another device",
      actionLabel: "Reload",
      onAction: () => location.reload(),
    },
    document,
    { key: "store", unless: up },
  );
}

/** What the last read found, or null before one answered (or when none could). */
export function storeRead(): ConfigReadBody | null {
  // Checked again for the page now in the document: the read may have been made for another one.
  return current !== null && current.built === builtHere() ? current : null;
}
