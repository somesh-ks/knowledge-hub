import { playUiCue } from "../sound/soundController";
import { cueForSheet } from "../sound/soundMap";
import { createPlayerSheetController } from "./sheetController";

/** The one expanded-player controller. Creating it touches nothing, so it is safe during SSR. */
export const playerSheet = createPlayerSheetController({
  // A cue at the moment of commit: the swipe that springs back is not a commit and stays silent.
  onCommitOpen: () => playUiCue(cueForSheet(true)),
  onCommitClose: () => playUiCue(cueForSheet(false)),
});
