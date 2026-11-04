// The seed sources an edit is applied against besides the stored documents (D149), and the public
// files the pages were built from, which a read compares the stored ones with: imported as text so
// they travel inside the function, from the commit the pages were built from. Read only with the
// config store on. Kept out of the route so a test can stand in for them (CI has none, D296).
import builtPreferences from "../../../../config/preferences.json?raw";
import builtOwner from "../../../../config/profiles/owner.json?raw";
import builtSchedule from "../../../../config/schedule.json?raw";
import seedSources from "../../../../config/sources.json?raw";
import builtSourcesUser from "../../../../config/sources.user.json?raw";
import builtTopics from "../../../../config/topics.json?raw";
import type { BuiltConfigFiles } from "../lib/configHash";

// The podcast structure (D170) is absent until the owner first edits one, so it is globbed: a
// missing file is an empty match, not a failed build.
const structureFile = import.meta.glob<string>("../../../../config/structure.json", {
  query: "?raw",
  import: "default",
  eager: true,
});
const builtStructure = Object.values(structureFile)[0];

export { seedSources };

// Typed by BUILT_CONFIG_PATHS, so the digest the pages carry covers exactly the files diffed from.
export const builtFiles: BuiltConfigFiles = {
  "config/topics.json": builtTopics,
  "config/sources.json": seedSources,
  "config/sources.user.json": builtSourcesUser,
  "config/schedule.json": builtSchedule,
  "config/preferences.json": builtPreferences,
  "config/profiles/owner.json": builtOwner,
  "config/structure.json": builtStructure,
};
