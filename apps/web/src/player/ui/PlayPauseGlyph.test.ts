import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PlayerState } from "../core/playerTypes";
import { ICON_PATHS } from "./iconPaths";
import PlayPauseGlyph from "./PlayPauseGlyph";

function paths(status: PlayerState["status"]): string[] {
  const html = renderToStaticMarkup(createElement(PlayPauseGlyph, { status }));
  return [...html.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1] ?? "");
}

describe("PlayPauseGlyph", () => {
  it("draws refresh for an error and replay at the end", () => {
    expect(paths("error")).toEqual([ICON_PATHS.refresh]);
    expect(paths("ended")).toEqual([ICON_PATHS.replay]);
  });

  it("keeps the play and pause swap otherwise", () => {
    for (const status of ["idle", "paused", "playing", "loading"] as const) {
      expect(paths(status)).toEqual([ICON_PATHS.play, ICON_PATHS.pause]);
    }
  });
});
