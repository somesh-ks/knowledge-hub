import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../player/core/testing";
import { createPassphraseMemory, PASSPHRASE_STORAGE_KEY } from "./passphraseMemory";

describe("createPassphraseMemory", () => {
  it("keeps the passphrase for the session only, unless asked to remember it", () => {
    const storage = new MemoryStorage();
    const memory = createPassphraseMemory(storage);
    expect(memory.get()).toBeNull();
    memory.set({ value: "open sesame", remember: false });
    expect(memory.get()).toBe("open sesame");
    expect(storage.getItem(PASSPHRASE_STORAGE_KEY)).toBeNull();
    // A new session starts empty.
    expect(createPassphraseMemory(storage).get()).toBeNull();
  });

  it("keeps it on the device when asked, for the next session", () => {
    const storage = new MemoryStorage();
    createPassphraseMemory(storage).set({ value: "open sesame", remember: true });
    expect(createPassphraseMemory(storage).get()).toBe("open sesame");
  });

  it("stops remembering when the next answer says not to", () => {
    const storage = new MemoryStorage();
    const memory = createPassphraseMemory(storage);
    memory.set({ value: "open sesame", remember: true });
    memory.set({ value: "open sesame", remember: false });
    expect(storage.getItem(PASSPHRASE_STORAGE_KEY)).toBeNull();
    expect(memory.get()).toBe("open sesame");
  });

  it("forgets everywhere on clear", () => {
    const storage = new MemoryStorage();
    const memory = createPassphraseMemory(storage);
    memory.set({ value: "wrong", remember: true });
    memory.clear();
    expect(memory.get()).toBeNull();
    expect(storage.getItem(PASSPHRASE_STORAGE_KEY)).toBeNull();
  });

  it("works from memory where storage is refused or full", () => {
    const none = createPassphraseMemory(null);
    none.set({ value: "open sesame", remember: true });
    expect(none.get()).toBe("open sesame");

    const full = new MemoryStorage();
    full.throwOnWrite = true;
    const memory = createPassphraseMemory(full);
    memory.set({ value: "open sesame", remember: true });
    expect(memory.get()).toBe("open sesame");
  });
});
