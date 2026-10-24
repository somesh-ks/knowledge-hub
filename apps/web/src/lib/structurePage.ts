import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  defaultBlockPrompt,
  defaultStructure,
  GENERAL_SECTION_ID,
  isBlockSection,
  SECTION_TITLES,
  STRUCTURE_KINDS,
  STRUCTURE_SECTIONS,
  type StructureBlock,
  StructureFile,
  type StructureKind,
  storedStructure,
} from "@dispatch/core";
import type { ManageSection, ManageTopic } from "./manage";
import { findRepoRoot } from "./repoRoot";
import type { ScheduleView } from "./schedule";
import { usesFixtures } from "./site";
import type { SectionOffer, StructureData } from "./structureView";

/** config/structure.json as written, or null when it is missing or malformed (every kind's defaults). */
async function readStructure(
  env: Record<string, string | undefined>,
): Promise<StructureFile | null> {
  const repo = findRepoRoot(process.cwd(), env);
  const base = usesFixtures(env) ? join(repo, "apps", "web", "src", "fixtures") : repo;
  try {
    const parsed = StructureFile.safeParse(
      JSON.parse(await readFile(join(base, "config", "structure.json"), "utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** One block of each type, to ask core for the built-in prompt each type takes in a kind. */
const SAMPLES: StructureBlock[] = [
  { type: "hello" },
  { type: "rundown" },
  { type: "section", id: "design", depth: "brief" },
  { type: "top_picks", depth: "deep" },
  { type: "trending" },
  { type: "release_news" },
  { type: "close", length: "short" },
  { type: "sign_off" },
];

/**
 * What the Structure view is built with (D170): each kind's blocks (stored, or the defaults for the
 * owner's topics, as the engine runs them), the prompts, the built-in prompts the engine reads
 * (core's own strings, so what the page shows is what the writer is told), and the sections the
 * owner's topics offer with the topics each gathers, for the "off in daily" line.
 */
export async function loadStructureData(
  topics: readonly ManageTopic[],
  sectionList: readonly ManageSection[],
  schedule: ScheduleView,
  env: Record<string, string | undefined> = process.env,
): Promise<StructureData> {
  const file = await readStructure(env);
  // A general news topic files under "general", which stands for its own episodes, not a section.
  const filed = topics.filter((topic) => topic.section_id !== GENERAL_SECTION_ID);
  const extra = [...new Set(filed.map((topic) => topic.section_id))];
  const ids = [
    ...STRUCTURE_SECTIONS,
    ...extra.filter(
      (id) => !isBlockSection(id) && !(STRUCTURE_SECTIONS as readonly string[]).includes(id),
    ),
  ];
  const title = (id: string): string =>
    sectionList.find((section) => section.id === id)?.title ??
    (SECTION_TITLES as Record<string, string>)[id] ??
    id;
  const sections: SectionOffer[] = ids.map((id) => ({
    id,
    name: title(id),
    topics: filed.filter((topic) => topic.section_id === id).map((topic) => topic.id),
  }));
  const texts: string[] = [];
  const builtins = {} as StructureData["builtins"];
  const blocks = {} as StructureData["blocks"];
  const prompts = {} as StructureData["prompts"];
  for (const kind of STRUCTURE_KINDS) {
    builtins[kind] = {};
    for (const sample of SAMPLES) {
      const text = defaultBlockPrompt(kind, sample);
      if (text === null) continue;
      if (!texts.includes(text)) texts.push(text);
      builtins[kind][sample.type] = texts.indexOf(text);
    }
    blocks[kind] = storedStructure(file, kind) ?? defaultStructure(kind as StructureKind, extra);
    prompts[kind] = { ...(file?.prompts?.[kind] ?? {}) };
  }
  return {
    blocks,
    prompts,
    texts,
    builtins,
    sections,
    skip: { daily: [...schedule.skipTopics], weekly: [...schedule.weekly.skip_topics] },
  };
}
