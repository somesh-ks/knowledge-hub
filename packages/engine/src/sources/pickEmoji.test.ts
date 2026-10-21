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
