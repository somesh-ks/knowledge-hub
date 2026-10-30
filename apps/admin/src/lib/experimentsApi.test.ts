import { describe, expect, it } from "vitest";
import { type ExperimentStore, handleExperiments } from "./experimentsApi";

function recordingStore(): ExperimentStore & { writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    read: async () => [],
    setEnabled: async (id, enabled) => {
      writes.push(`${id} ${enabled}`);
      return true;
    },
    setPromoted: async (id, promoted) => {
      writes.push(`${id} promoted ${promoted}`);
    },
  };
}

const post = (body: unknown, contentType: string | null = "application/json") => ({
  method: "POST",
  contentType,
  bodyText: JSON.stringify(body),
});

describe("the Experiments switch route", () => {
  // The route flips what the next daily does, so a request a page did not make must write nothing:
  // a form post from another site (not JSON), or a switch the engine does not read (ingest has none).
  it.each([
    ["a form post", post({ id: "alexandria", action: "on" }, "application/x-www-form-urlencoded")],
    ["an experiment with no switch", post({ id: "ingest", action: "on" })],
    ["an unknown experiment", post({ id: "nope", action: "on" })],
    ["an unknown action", post({ id: "alexandria", action: "delete" })],
  ])("%s writes nothing", async (_name, request) => {
    const store = recordingStore();
    const answer = await handleExperiments(request, store);
    expect(answer.status).toBeGreaterThanOrEqual(400);
    expect(store.writes).toEqual([]);
  });

  it("a page's switch is written and the new state returned", async () => {
    const store = recordingStore();
    const answer = await handleExperiments(post({ id: "alexandria", action: "on" }), store);
    expect(answer.status).toBe(200);
    expect(store.writes).toEqual(["alexandria true"]);
  });

  // The bug it prevents: a stale tab turning off an experiment another tab promoted was refused with
  // no state to show, so the tab kept its old switch and every retry was refused again.
  it("a refused switch-off returns the current flags so the page can catch up", async () => {
    const promoted = { id: "alexandria", enabled: true, promoted_at: 1 };
    const store: ExperimentStore = {
      read: async () => [promoted],
      setEnabled: async () => false,
      setPromoted: async () => {},
    };
    const answer = await handleExperiments(post({ id: "alexandria", action: "off" }), store);
    expect(answer).toEqual({ status: 409, body: { error: "promoted", flags: [promoted] } });
  });
});
