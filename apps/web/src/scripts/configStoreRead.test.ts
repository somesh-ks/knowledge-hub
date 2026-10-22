import { afterEach, describe, expect, it, vi } from "vitest";
import { loadStore, storeRead } from "./configStoreRead";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadStore", () => {
  // The bug: whichever read ended last set what the page used, so a slow first read that failed
  // after a newer one answered took the store's edits away and the rows went back to the build.
  it("lets only the newest read speak for the store", async () => {
    vi.stubGlobal("document", { querySelector: () => ({ content: "built-here" }) });
    const answers: ((response: Response) => void)[] = [];
    vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => answers.push(resolve)));
    const ops = [{ op: "source.set", id: "studio-notes", enabled: false }];
    const older = loadStore(0);
    const newer = loadStore(5000);
    answers[1]?.(
      Response.json({ status: 200, built: "built-here", written_at: null, ops, sources: [] }),
    );
    await newer;
    answers[0]?.(new Response(null, { status: 503 }));
    await older;
    expect(storeRead()?.ops).toEqual(ops);
  });
});
