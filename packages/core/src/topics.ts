import { z } from "zod";
import {
  CATEGORIES,
  type Category,
  DESIGN_TOPIC_ID,
  hasOwnAllowance,
  homeSection,
  IdString,
  isBuiltinCategory,
  isBuiltinSection,
  NORMAL_TASTE,
  SECTION_TITLES,
  SECTIONS,
  SectionId,
  TRENDING_TOPIC_ID,
} from "./categories.js";
import { GENERAL_TOPICS, type GeneralTopicId, isGeneralTopicId } from "./generalTopics.js";
import { SourceFormat } from "./sources.js";
import { TOPIC_GROUP_IDS } from "./topicGroups.js";

/**
 * How a topic is scored beyond fit. "craft" and "launch" multiply the fit by the same depth
 * factors the built-in categories use; "fit_only" scores on fit alone, which suits most custom
 * topics because the reader asked for a subject, not for technique. "coverage" multiplies by how
 * many distinct outlets reported the story (Trending, D40); a story one outlet carried scores 0.
 */
export const TOPIC_DEPTHS = ["craft", "launch", "fit_only", "coverage"] as const;
export const TopicDepth = z.enum(TOPIC_DEPTHS);
export type TopicDepth = z.infer<typeof TopicDepth>;

/**
 * "builtin" topics are the twelve judge categories. "custom" topics are the owner's. "app" topics
 * ship with the app (Design and Trending): judged by fit like a custom topic, but they can be
 * switched off and never removed, and they do not count toward MAX_CUSTOM_TOPICS. "general" topics
 * are the general news topics (World, Business, Science, Culture, Sports; D66): fed only by their
 * own news feeds, whose stories are judged so the feeds earn scores. They play in a scheduled
 * briefing or the weekly one unless its skip list names them, each as a section named after the
 * topic (`publishSection`), and in episodes. Like app topics they can be renamed and reworded and
 * never removed, and do not count toward MAX_CUSTOM_TOPICS; unlike them they are always on, so
 * `enabled` is read for no general topic.
 */
export const TOPIC_ORIGINS = ["builtin", "custom", "app", "general"] as const;
export const TopicOrigin = z.enum(TOPIC_ORIGINS);
export type TopicOrigin = z.infer<typeof TopicOrigin>;

/** Ids a custom topic can never take: they mean something to the judge or to the layout. */
export const RESERVED_TOPIC_IDS: readonly string[] = [
  "none",
  "top",
  "watch",
  "technology",
  DESIGN_TOPIC_ID,
  TRENDING_TOPIC_ID,
  ...GENERAL_TOPICS.map((topic) => topic.id),
  // The pages of the owner's four topics take these ids.
  ...TOPIC_GROUP_IDS,
];

/**
 * The section a general topic stores. It is a placeholder: topics.json lists no such section and
 * no digest has it. A general topic's stories publish in a section of its own id (`publishSection`).
 */
export const GENERAL_SECTION_ID = "general";

/** The section a topic's stories publish in: a general topic's own id, else its `section_id`. */
export function publishSection(topic: Pick<Topic, "id" | "origin" | "section_id">): string {
  return topic.origin === "general" ? topic.id : topic.section_id;
}

/** Ids of the topics that ship with the app. */
export const APP_TOPIC_IDS: readonly string[] = [DESIGN_TOPIC_ID, TRENDING_TOPIC_ID];

/** Judging a custom topic costs a model call per candidate, so the number of them is bounded. */
export const MAX_CUSTOM_TOPICS = 12;
export const MAX_KEYWORDS = 30;

export const TopicSection = z.object({
  id: SectionId,
  title: z.string().trim().min(1).max(60),
  /** Position in the digest, ascending. Built-in sections keep their historical order. */
  order: z.number().int().nonnegative(),
});
export type TopicSection = z.infer<typeof TopicSection>;

/**
 * The five stops of the type mix. A stop multiplies the score of a story whose source has that
 * format (type); Off keeps such stories out. Normal is the default and is left out of the file.
 */
export const MIX_STOPS = [
  { name: "Off", factor: 0 },
  { name: "Less", factor: 0.85 },
  { name: "Normal", factor: 1 },
  { name: "More", factor: 1.1 },
  { name: "Most", factor: 1.2 },
] as const;
export const MixStop = z.enum(["Off", "Less", "Normal", "More", "Most"]);
export type MixStop = z.infer<typeof MixStop>;
/** The type mix, one for every topic (config/preferences.json): the stop of each format that is not Normal. */
export const FormatMix = z.partialRecord(SourceFormat, MixStop);
export type FormatMix = z.infer<typeof FormatMix>;

/** The multiplier of a mix stop given by name or by its factor; anything else reads as Normal. */
export function mixFactor(stop: string | number | undefined): number {
  const found = MIX_STOPS.find((s) => s.name === stop || s.factor === stop);
  return found?.factor ?? 1;
}

/** The stop nearest to a factor, by name. */
export function mixStopOf(factor: number): MixStop {
  let best: (typeof MIX_STOPS)[number] = MIX_STOPS[2];
  for (const stop of MIX_STOPS) {
    if (Math.abs(stop.factor - factor) < Math.abs(best.factor - factor)) best = stop;
  }
  return best.name;
}

/** The perspective stops, -2 to 2; Even (0) changes nothing and is left out of the file. */
export const PERSPECTIVE_STOPS = [
  { name: "Left", value: -2 },
  { name: "Centre-left", value: -1 },
  { name: "Even", value: 0 },
  { name: "Centre-right", value: 1 },
  { name: "Right", value: 2 },
] as const;
/** The most a perspective can move a story's score, either way. */
export const PERSPECTIVE_REACH = 0.15;
export const Perspective = z.number().int().min(-2).max(2);

/**
 * The multiplier perspective gives a general story: 1 + 15% x (perspective x mean lean) / 4, where
 * lean runs -2 to 2. Unrated outlets count as Centre (0); no perspective, or Even, is exactly 1.
 */
export function perspectiveFactor(
  perspective: number | undefined,
  leans: readonly number[],
): number {
  if (!perspective || leans.length === 0) return 1;
  const mean = leans.reduce((sum, lean) => sum + lean, 0) / leans.length;
  return 1 + (PERSPECTIVE_REACH * perspective * mean) / 4;
}

/** Topic weight is gone (D194); preserve old mutes, including built-in categories that ignore enabled. */
export const MUTED_WEIGHT = 0.05;
function muteOldWeight(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || !("weight" in raw)) return raw;
  const { weight, ...rest } = raw as Record<string, unknown>;
  if (!(typeof weight === "number" && weight <= MUTED_WEIGHT)) return rest;
  return {
    ...rest,
    enabled: false,
    ...(rest.origin === "builtin" ? { never_publish: true } : {}),
  };
}

export const Topic = z.preprocess(
  muteOldWeight,
  z.object({
    /** Built-in topics use the category enum strings, so scoring and old digests keep their ids. */
    id: IdString,
    name: z.string().trim().min(1).max(60),
    /** What belongs in the topic. Read by the judge for a custom topic, so it should be concrete. */
    description: z.string().trim().min(1).max(400),
    /**
     * What counts and what does not, in the owner's words (D234). Added to the fit question of a
     * topic Jev judges by fit (custom, Design, general); the twelve built-in categories are judged
     * by their fixed criteria and ignore it. Absent leaves the question exactly as it was.
     */
    rubric: z.string().trim().min(1).max(600).optional(),
    enabled: z.boolean(),
    /** A candidate must contain one of these (or come from a tagged source) to be judged for a custom topic. */
    keywords: z.array(z.string().trim().min(1).max(60)).max(MAX_KEYWORDS),
    section_id: SectionId,
    never_publish: z.boolean(),
    origin: TopicOrigin,
    depth: TopicDepth,
    /** One emoji shown beside the topic on the Sources page. Built-in topics have theirs in the site's code. */
    emoji: z.string().trim().min(1).max(16).optional(),
    /** General topics only: -2 (Left) to 2 (Right), leaning stories toward that side. Absent is Even. */
    perspective: Perspective.optional(),
  }),
);
export type Topic = z.infer<typeof Topic>;

/**
 * What a topic is scored at. Not set by the owner (D194): the topics that ship as app or general
 * topics keep the strength they always had, everything else competes on merit.
 */
export function topicTaste(topic: Pick<Topic, "id" | "origin">): number {
  if (topic.origin === "general" || topic.id === TRENDING_TOPIC_ID) return 1;
  if (topic.id === DESIGN_TOPIC_ID) return 0.85;
  return NORMAL_TASTE;
}

/** Shape of config/topics.json. */
export const TopicsFile = z
  .object({
    version: z.literal(1),
    sections: z.array(TopicSection),
    topics: z.array(Topic),
  })
  .superRefine((file, ctx) => {
    const sectionIds = new Set<string>();
    for (const [index, section] of file.sections.entries()) {
      if (sectionIds.has(section.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["sections", index, "id"],
          message: `duplicate section id ${section.id}`,
        });
      }
      sectionIds.add(section.id);
    }
    const topicIds = new Set<string>();
    let custom = 0;
    for (const [index, topic] of file.topics.entries()) {
      const at = (field: string): (string | number)[] => ["topics", index, field];
      if (topicIds.has(topic.id)) {
        ctx.addIssue({ code: "custom", path: at("id"), message: `duplicate topic id ${topic.id}` });
      }
      topicIds.add(topic.id);
      if (
        topic.origin === "general"
          ? topic.section_id !== GENERAL_SECTION_ID
          : !sectionIds.has(topic.section_id)
      ) {
        ctx.addIssue({
          code: "custom",
          path: at("section_id"),
          message: `unknown section ${topic.section_id}`,
        });
      }
      if (topic.origin === "builtin") {
        if (!isBuiltinCategory(topic.id)) {
          ctx.addIssue({
            code: "custom",
            path: at("id"),
            message: `${topic.id} is not a built-in category`,
          });
        }
      } else if (topic.origin === "app") {
        if (!APP_TOPIC_IDS.includes(topic.id)) {
          ctx.addIssue({
            code: "custom",
            path: at("id"),
            message: `${topic.id} is not a topic that ships with the app`,
          });
        }
      } else if (topic.origin === "general") {
        if (!isGeneralTopicId(topic.id)) {
          ctx.addIssue({
            code: "custom",
            path: at("id"),
            message: `${topic.id} is not a general news topic`,
          });
        }
      } else {
        custom += 1;
        if (isBuiltinCategory(topic.id) || RESERVED_TOPIC_IDS.includes(topic.id)) {
          ctx.addIssue({
            code: "custom",
            path: at("id"),
            message: `${topic.id} is reserved for a built-in topic`,
          });
        }
      }
    }
    if (custom > MAX_CUSTOM_TOPICS) {
      ctx.addIssue({
        code: "custom",
        path: ["topics"],
        message: `at most ${MAX_CUSTOM_TOPICS} custom topics`,
      });
    }
  });
export type TopicsFile = z.infer<typeof TopicsFile>;

/** Section titles and order as they have always been. Order doubles as the digest order. */
export const BUILTIN_SECTIONS: readonly TopicSection[] = SECTIONS.map((id, order) => ({
  id,
  title: SECTION_TITLES[id],
  order,
}));

/** Name, one-line hint (kept as the description) and depth of each built-in category. Weights come from the preferences. */
const BUILTIN_META: Record<Category, { name: string; description: string; depth: TopicDepth }> = {
  design_engineering_craft: {
    name: "Build breakdowns",
    description: "How a detail was made, with code",
    depth: "craft",
  },
  hci_empirical_research: {
    name: "User studies",
    description: "Research with a method and results",
    depth: "craft",
  },
  ui_component_primitives: {
    name: "Components",
    description: "Dialogs, popovers, component libraries",
    depth: "craft",
  },
  ai_ux_interaction_patterns: {
    name: "AI interface patterns",
    description: "Chat, agents, streaming UI",
    depth: "craft",
  },
  css_canvas_motion_techniques: {
    name: "Motion and CSS",
    description: "Techniques with a demo",
    depth: "craft",
  },
  frontier_model_releases: {
    name: "Model releases",
    description: "Model cards, benchmarks, reports",
    depth: "craft",
  },
  developer_tool_launches: {
    name: "Tool launches",
    description: "New frameworks, editors, CLIs",
    depth: "craft",
  },
  software_engineering_depth: {
    name: "Engineering deep dives",
    description: "Architecture, performance and internals, with code",
    depth: "craft",
  },
  taste_and_design_philosophy: {
    name: "Design essays",
    description: "Taste, principles, how to think",
    depth: "craft",
  },
  venture_capital_and_gossip: {
    name: "Funding and gossip",
    description: "Rounds, valuations, acquisitions",
    depth: "fit_only",
  },
  generic_ai_hype_listicles: {
    name: "AI hype lists",
    description: "Top-10 tools, no technique",
    depth: "fit_only",
  },
  consumer_tech_releases: {
    name: "Device launches",
    description: "Phones, laptops, chips, OS updates",
    depth: "launch",
  },
};

/** The built-in topics, in category order. */
export function builtinTopics(): Topic[] {
  return CATEGORIES.map((id): Topic => {
    const meta = BUILTIN_META[id];
    const section = homeSection(id, "rss");
    return {
      id,
      name: meta.name,
      description: meta.description,
      enabled: true,
      keywords: [],
      section_id: section ?? "top",
      never_publish: false,
      origin: "builtin",
      depth: meta.depth,
    };
  });
}

/**
 * The topics that ship with the app (D39). Each is judged by fit with the existing custom-topic
 * question, publishes in the section of the same id, and is fed by the sources tagged with its id.
 * The wording is part of the judge question's hash, so edit it only on purpose.
 */
export function appTopics(): Topic[] {
  return [
    {
      id: DESIGN_TOPIC_ID,
      name: "Design",
      description:
        "Product, UI, UX and visual design news and essays for a designer: interface and interaction design, usability research, design systems, branding and the craft and practice of design. Not architecture, furniture or interiors.",
      enabled: true,
      keywords: [],
      section_id: "design",
      never_publish: false,
      origin: "app",
      depth: "fit_only",
    },
    {
      id: TRENDING_TOPIC_ID,
      name: "Trending",
      description:
        "A news story that several major outlets are covering at once, in any field: politics, economy, science, health, technology, world events. Not sports results, celebrity gossip, obituaries of no wider interest, local crime, opinion columns or product reviews.",
      enabled: true,
      keywords: [],
      section_id: "trending",
      never_publish: false,
      origin: "app",
      depth: "coverage",
    },
  ];
}

/**
 * What counts as each general topic. Read by the judge as the topic's fit question, so its
 * sources earn quality scores; the wording is part of the question's hash, so edit it on purpose.
 */
const GENERAL_DESCRIPTIONS: Record<GeneralTopicId, string> = {
  world:
    "International news and world affairs: conflicts, diplomacy, elections and governments, disasters and humanitarian crises, and major events in any country.",
  business:
    "Business and economic news: markets, companies, earnings, deals, jobs, trade, prices, interest rates and the policies that move them.",
  science:
    "Science and health news: research findings, space, climate and the environment, medicine and public health, reported from a study or an expert.",
  culture:
    "Arts and culture news: film, television, music, books, art, games and the trends around them. Not sports results.",
  sports:
    "Sports news: results, tournaments, transfers, records and the stories around teams and athletes in major sports.",
};

/**
 * The general news topics (D66). Each is fed by the news feeds tagged with its id, ranked by how
 * many outlets carried a story, and names GENERAL_SECTION_ID, which stands for the section of its
 * own id (`publishSection`).
 */
export function generalTopics(): Topic[] {
  return GENERAL_TOPICS.map(
    ({ id, title }): Topic => ({
      id,
      name: title,
      description: GENERAL_DESCRIPTIONS[id],
      enabled: true,
      keywords: [],
      section_id: GENERAL_SECTION_ID,
      never_publish: false,
      origin: "general",
      depth: "coverage",
    }),
  );
}

/** What config/topics.json holds before anyone adds a topic: the built-ins and today's sections. */
export function seedTopicsFile(): TopicsFile {
  return {
    version: 1,
    sections: BUILTIN_SECTIONS.map((section) => ({ ...section })),
    topics: [...builtinTopics(), ...appTopics(), ...generalTopics()],
  };
}

/**
 * The topics a run works from. Built-in topics missing from the file are restored. A missing
 * file reads as the seed.
 */
export function resolveTopics(file: TopicsFile | null | undefined): TopicsFile {
  const base = file ?? seedTopicsFile();
  const seed = new Map(
    [...builtinTopics(), ...appTopics(), ...generalTopics()].map((topic) => [topic.id, topic]),
  );
  const present = new Set(base.topics.map((topic) => topic.id));
  const topics = base.topics.map((topic): Topic => {
    // A general topic is always on, whatever an older file stored.
    if (topic.origin === "general") return topic.enabled ? topic : { ...topic, enabled: true };
    if (topic.origin !== "builtin") return topic;
    if (!isBuiltinCategory(topic.id)) return topic;
    // The section follows the code, so a routing change (D39) reaches a topics.json written before it.
    return {
      ...topic,
      section_id: seed.get(topic.id)?.section_id ?? topic.section_id,
    };
  });
  for (const [id, topic] of seed) if (!present.has(id)) topics.push(topic);
  // Built-in sections take their title and order from the code, so a retitle reaches a file
  // written before it. A section a custom topic created is the owner's and is left alone.
  const sections = [
    ...BUILTIN_SECTIONS.map((section) => ({ ...section })),
    ...base.sections.filter((section) => !isBuiltinSection(section.id)),
  ];
  return { version: 1, sections, topics };
}

/**
 * The file with the general topics it lacks added, as resolveTopics restores them, for a stage
 * that places stories by topic without the preferences resolveTopics needs. Null stays null.
 */
export function withGeneralTopics(file: TopicsFile | null): TopicsFile | null {
  if (file === null) return null;
  const present = new Set(file.topics.map((topic) => topic.id));
  const missing = generalTopics().filter((topic) => !present.has(topic.id));
  return missing.length === 0 ? file : { ...file, topics: [...file.topics, ...missing] };
}

/** Custom topics that are switched on. */
export function activeCustomTopics(file: TopicsFile): Topic[] {
  return file.topics.filter((topic) => topic.origin === "custom" && topic.enabled);
}

/**
 * Topics a briefing judges by fit: the owner's custom topics and the app's own (Design, Trending),
 * when switched on. The built-in categories are judged by the fixed question set instead, and the
 * general topics only on their own feeds' stories (activeGeneralTopics).
 */
export function activeFitTopics(file: TopicsFile): Topic[] {
  return file.topics.filter(
    (topic) => topic.origin !== "builtin" && topic.origin !== "general" && topic.enabled,
  );
}

/** The general news topics (D66). They are always on: a stored `enabled` is not read. */
export function activeGeneralTopics(file: TopicsFile): Topic[] {
  return file.topics.filter((topic) => topic.origin === "general");
}

/** True when the id names a topic that ships with the app and the file has it switched off. */
export function isDisabledAppTopic(file: TopicsFile | null | undefined, id: string): boolean {
  if (!APP_TOPIC_IDS.includes(id)) return false;
  return file?.topics.find((topic) => topic.id === id)?.enabled === false;
}

/**
 * Home section for a category or topic id. A built-in category keeps the section it has always
 * had; a custom or app topic follows its `section_id`, and a general topic publishes in a section
 * of its own id. Null for a topic that never publishes, and for an id nobody knows (a removed
 * topic). A video goes where its topic goes.
 */
export function homeSectionFor(
  topics: TopicsFile | null | undefined,
  id: string,
  sourceType: string,
): string | null {
  if (isBuiltinCategory(id)) return homeSection(id, sourceType);
  const topic = topics?.topics.find((candidate) => candidate.id === id);
  if (!topic || topic.never_publish) return null;
  return publishSection(topic);
}

/** Ids of the built-in categories set never to publish in the topics a run works from. */
export function offCategories(topics: TopicsFile | null | undefined): string[] {
  return (topics?.topics ?? [])
    .filter((topic) => topic.origin === "builtin" && topic.never_publish)
    .map((topic) => topic.id);
}

/** True when a built-in category is set never to publish in the topics a run works from. */
export function categoryIsOff(topics: TopicsFile | null | undefined, id: string): boolean {
  const topic = topics?.topics.find((candidate) => candidate.id === id);
  return topic?.origin === "builtin" && topic.never_publish;
}

/**
 * Section titles by id for a digest to keep: the file's sections plus one for each general topic,
 * titled with its name (the section a general topic's stories publish in has no row in the file).
 */
export function topicSectionTitles(file: TopicsFile): Record<string, string> {
  return {
    ...Object.fromEntries(file.sections.map((section) => [section.id, section.title])),
    ...Object.fromEntries(
      file.topics.filter((topic) => topic.origin === "general").map((t) => [t.id, t.name]),
    ),
  };
}

/** True when an id publishes in a section of its own allowance (custom sections and Tech). */
export function ownsAllowance(
  topics: TopicsFile | null | undefined,
  id: string,
  sourceType: string,
): boolean {
  const home = homeSectionFor(topics, id, sourceType);
  return home !== null && hasOwnAllowance(home);
}

/** Sections in digest order. Ties on `order` keep file order. */
export function orderedTopicSections(file: TopicsFile): TopicSection[] {
  return file.sections
    .map((section, index) => ({ section, index }))
    .sort((a, b) => a.section.order - b.section.order || a.index - b.index)
    .map(({ section }) => section);
}

/** Lowercase id from a display name: letters and digits joined by underscores. */
export function topicIdFromName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return slug === "" ? "topic" : slug;
}
