import { beforeEach, describe, expect, it } from "vitest";
import {
  dismissInstallHint,
  INSTALL_DISMISSED_KEY,
  INSTALL_VISITS_KEY,
  type InstallHintContext,
  isIosSafari,
  readDismissed,
  readVisits,
  recordInstallVisit,
  resetVisitGuard,
  shouldShowInstallHint,
} from "./installHint";
import {
  createPreferencesStore,
  DEFAULT_PREFERENCES,
  PREFERENCES_KEY,
  parsePreferences,
} from "./preferences";
import { MemoryStorage } from "./testing";

describe("parsePreferences", () => {
  it("falls back to defaults for nothing, garbage and the wrong shape", () => {
    expect(parsePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences("not json")).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences("[1,2]")).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences("null")).toEqual(DEFAULT_PREFERENCES);
  });

  it("keeps valid fields and replaces invalid ones one by one", () => {
    const parsed = parsePreferences(
      JSON.stringify({
        theme: "dark",
        style: "expressive",
        sounds: false,
        volume: 4,
        rate: 1.5,
        autoplay: false,
      }),
    );
    expect(parsed).toEqual({
      theme: "dark",
      style: "expressive",
      sounds: false,
      haptics: true,
      volume: 1,
      rate: 1.5,
      autoplay: false,
    });
    const partial = parsePreferences(
      JSON.stringify({ theme: "neon", style: "Halloween<script>", rate: 3, volume: "loud" }),
    );
    expect(partial).toEqual(DEFAULT_PREFERENCES);
  });

  it("clamps the volume to the slider's range", () => {
    expect(parsePreferences(JSON.stringify({ volume: -3 })).volume).toBe(0);
  });
});

describe("preferences store", () => {
  it("persists changes and restores them in a new store", () => {
    const storage = new MemoryStorage();
    const first = createPreferencesStore({ storage, defaultSounds: () => true });
    first.set({ theme: "light", rate: 1.25, volume: 0.4 });
    expect(JSON.parse(storage.getItem(PREFERENCES_KEY) ?? "{}")).toMatchObject({
      theme: "light",
      rate: 1.25,
      volume: 0.4,
    });
    const second = createPreferencesStore({ storage, defaultSounds: () => true });
    expect(second.get()).toMatchObject({ theme: "light", rate: 1.25, volume: 0.4 });
  });

  it("keeps another tab's change when this tab, which read the old copy, changes something else", () => {
    const storage = new MemoryStorage();
    const tabA = createPreferencesStore({ storage, defaultSounds: () => true });
    const tabB = createPreferencesStore({ storage, defaultSounds: () => true });
    tabA.set({ autoplay: false, theme: "dark" });
    tabB.set({ rate: 1.5 });
    expect(JSON.parse(storage.getItem(PREFERENCES_KEY) ?? "{}")).toMatchObject({
      autoplay: false,
      theme: "dark",
      rate: 1.5,
    });
    expect(tabB.get()).toMatchObject({ autoplay: false, theme: "dark", rate: 1.5 });
  });

  it("keeps a change the device would not take when a later change is made", () => {
    const storage = new MemoryStorage();
    const store = createPreferencesStore({ storage, defaultSounds: () => true });
    store.set({ theme: "dark" });
    storage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    store.set({ rate: 1.5 });
    store.set({ theme: "light" });
    expect(store.get()).toMatchObject({ theme: "light", rate: 1.5 });
  });

  it("does not keep a change that went back to what the device holds over a newer one from another tab", () => {
    const storage = new MemoryStorage();
    const store = createPreferencesStore({ storage, defaultSounds: () => true });
    const other = createPreferencesStore({ storage, defaultSounds: () => true });
    store.set({ theme: "dark" });
    const write = storage.setItem.bind(storage);
    storage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    store.set({ theme: "light" });
    store.set({ theme: "dark" });
    storage.setItem = write;
    other.set({ theme: "light" });
    store.set({ rate: 1.5 });
    expect(store.get()).toMatchObject({ theme: "light", rate: 1.5 });
  });

  it("keeps the snapshot identity until something changes, and notifies once per change", () => {
    const store = createPreferencesStore({
      storage: new MemoryStorage(),
      defaultSounds: () => true,
    });
    const snapshot = store.get();
    let calls = 0;
    const off = store.subscribe(() => {
      calls += 1;
    });
    store.set({ theme: "system" });
    expect(store.get()).toBe(snapshot);
    expect(calls).toBe(0);
    store.set({ theme: "dark" });
    expect(store.get()).not.toBe(snapshot);
    expect(calls).toBe(1);
    off();
    store.set({ theme: "light" });
    expect(calls).toBe(1);
  });

  it("follows the reduced-motion default until the listener chooses, and an explicit choice wins", () => {
    let reducedMotion = true;
    const store = createPreferencesStore({
      storage: new MemoryStorage(),
      defaultSounds: () => !reducedMotion,
    });
    expect(store.getSoundsEnabled()).toBe(false);
    reducedMotion = false;
    expect(store.getSoundsEnabled()).toBe(true);
    store.set({ sounds: false });
    expect(store.getSoundsEnabled()).toBe(false);
    reducedMotion = true;
    store.set({ sounds: true });
    expect(store.getSoundsEnabled()).toBe(true);
  });

  it("works without storage and when storage throws", () => {
    const store = createPreferencesStore({ storage: null, defaultSounds: () => true });
    expect(() => store.set({ theme: "dark" })).not.toThrow();
    expect(store.get().theme).toBe("dark");
    const storage = new MemoryStorage();
    storage.throwOnWrite = true;
    const failing = createPreferencesStore({ storage, defaultSounds: () => true });
    expect(() => failing.set({ rate: 2 })).not.toThrow();
    expect(failing.get().rate).toBe(2);
  });
});

describe("install hint", () => {
  const SAFARI_IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  const CHROME_IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1";
  const INSTAGRAM_WEBVIEW =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0";
  const SAFARI_IPAD_DESKTOP_UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
  const ANDROID_CHROME =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";

  const eligible: InstallHintContext = {
    userAgent: SAFARI_IPHONE,
    maxTouchPoints: 5,
    isStandalone: false,
    dismissed: false,
    visits: 2,
  };

  beforeEach(() => {
    resetVisitGuard();
  });

  it("shows in Safari on iOS after two visits when not installed and not dismissed", () => {
    expect(shouldShowInstallHint(eligible)).toBe(true);
  });

  it("waits for the second visit", () => {
    expect(shouldShowInstallHint({ ...eligible, visits: 1 })).toBe(false);
    expect(shouldShowInstallHint({ ...eligible, visits: 0 })).toBe(false);
  });

  it("stays away once installed or dismissed", () => {
    expect(shouldShowInstallHint({ ...eligible, isStandalone: true })).toBe(false);
    expect(shouldShowInstallHint({ ...eligible, dismissed: true })).toBe(false);
  });

  it("is Safari on iOS only, never other browsers, web views or other platforms", () => {
    expect(shouldShowInstallHint({ ...eligible, userAgent: CHROME_IPHONE })).toBe(false);
    expect(shouldShowInstallHint({ ...eligible, userAgent: INSTAGRAM_WEBVIEW })).toBe(false);
    expect(
      shouldShowInstallHint({ ...eligible, userAgent: ANDROID_CHROME, maxTouchPoints: 5 }),
    ).toBe(false);
    expect(
      shouldShowInstallHint({ ...eligible, userAgent: SAFARI_IPAD_DESKTOP_UA, maxTouchPoints: 0 }),
    ).toBe(false);
  });

  it("recognises iPadOS, which reports a Mac user agent with touch points", () => {
    expect(isIosSafari(SAFARI_IPAD_DESKTOP_UA, 5)).toBe(true);
    expect(isIosSafari(SAFARI_IPAD_DESKTOP_UA, 0)).toBe(false);
  });

  it("counts one visit per document and remembers dismissal for good", () => {
    const storage = new MemoryStorage();
    expect(recordInstallVisit(storage)).toBe(1);
    expect(recordInstallVisit(storage)).toBe(1);
    expect(readVisits(storage)).toBe(1);
    resetVisitGuard();
    expect(recordInstallVisit(storage)).toBe(2);
    expect(readDismissed(storage)).toBe(false);
    dismissInstallHint(storage);
    expect(storage.getItem(INSTALL_DISMISSED_KEY)).toBe("1");
    expect(readDismissed(storage)).toBe(true);
    expect(storage.getItem(INSTALL_VISITS_KEY)).toBe("2");
  });

  it("copes with storage that is missing or broken", () => {
    expect(readVisits(null)).toBe(0);
    expect(readDismissed(null)).toBe(false);
    expect(() => dismissInstallHint(null)).not.toThrow();
    const storage = new MemoryStorage();
    storage.setItem(INSTALL_VISITS_KEY, "garbage");
    expect(readVisits(storage)).toBe(0);
  });
});
