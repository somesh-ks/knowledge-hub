import { fallbackEmoji } from "@dispatch/core";
import { describe, expect, it } from "vitest";
import type { JevClientLike } from "../judge/jev.js";
import { EmojiPicker } from "./pickEmoji.js";

describe("EmojiPicker", () => {
  // The owner added "India" and got no flag: the choice list has none. A place is answered from the
  // table, so Jev (a paid call) is never asked for it.
  it("gives a place its flag without asking Jev", async () => {
    const client = {
      systemOne: () => {
        throw new Error("Jev must not be asked for a place");
      },
    } as unknown as JevClientLike;
    const picker = new EmojiPicker({ client, onFailure: (reason) => expect.fail(reason) });
    expect(await picker.pick({ name: "India tech" })).toBe("🇮🇳");
  });
});

// Jev down used to leave the keyword/hash fallback; the owner chose Gemini Flash-Lite as the backup,
// free to answer with any one emoji, and anything else must still end at the fallback.
describe("EmojiPicker backup", () => {
  const jevDown = {
    systemOne: () => {
      throw new Error("down");
    },
  } as unknown as JevClientLike;
  const picker = (backup: () => Promise<string>) =>
    new EmojiPicker({ client: jevDown, backup, onFailure: () => {} });

  it("uses the backup's emoji when Jev fails", async () => {
    expect(await picker(async () => " 🧠 ").pick({ name: "Neuroscience" })).toBe("🧠");
  });

  it("falls back when the backup answers text or two emoji", async () => {
    const expected = fallbackEmoji("Neuroscience");
    expect(await picker(async () => "a brain").pick({ name: "Neuroscience" })).toBe(expected);
    expect(await picker(async () => "🧠🔬").pick({ name: "Neuroscience" })).toBe(expected);
  });

  it("asks neither for a place", async () => {
    const boom = async () => {
      throw new Error("must not be asked");
    };
    const p = new EmojiPicker({ client: jevDown, backup: boom, onFailure: (r) => expect.fail(r) });
    expect(await p.pick({ name: "India tech" })).toBe("🇮🇳");
  });
});
