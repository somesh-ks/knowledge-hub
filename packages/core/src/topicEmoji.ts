import { placeEmoji } from "./placeEmoji.js";

/**
 * The emoji beside a topic on the Sources page. The shipped topics have a fixed one; a topic the
 * owner adds gets a flag when it names a place (`placeEmoji`), else one from Jev (a choice among
 * TOPIC_EMOJIS) and, when Jev cannot answer, `fallbackEmoji`, the same for the same name every time.
 */

/**
 * What each emoji stands for, as Jev is told it. The keys are the only answers it may give, and the
 * comma-separated phrases are also the keywords `fallbackEmoji` looks for, so keep them specific and
 * keep one meaning under one emoji. Places are not here: `placeEmoji` answers those with a flag.
 */
export const TOPIC_EMOJIS: Readonly<Record<string, string>> = {
  "🎨": "art, design, creativity",
  "🤖": "AI, machine learning, robots",
  "📱": "phones, gadgets, consumer technology",
  "💻": "software, programming, developer tools",
  "🌍": "world affairs, geography, geopolitics",
  "💼": "business, finance, work",
  "📈": "markets, economics, investing, stocks",
  "🔬": "science, research, laboratories",
  "🚀": "space, rockets, satellites, ambitious engineering",
  "🎭": "culture, theatre, books, literature",
  "🎵": "music, audio, podcasts",
  "🎮": "games, game design, esports",
  "⚽": "sports, football, soccer, cricket, basketball, tennis",
  "🍳": "food, cooking, restaurants, recipes",
  "🌱": "environment, climate, nature, gardening, sustainability",
  "⚡": "energy, electric vehicles, power, solar",
  "🏛️": "politics, government, policy, elections",
  "🎓": "education, learning, schools, universities",
  "🔐": "security, privacy, cryptography, cybersecurity",
  "📰": "news, media, journalism",
  "🏠": "home, interiors, architecture",
  "🧠": "psychology, thinking, productivity",
  "📷": "photography, video, film-making",
  "🩺": "health, medicine, healthcare, doctors, wellness",
  "🪙": "crypto, bitcoin, blockchain, web3",
  "🚗": "cars, automotive, driving",
  "🏎️": "motorsport, formula 1, racing",
  "👗": "fashion, clothing, apparel, style",
  "📜": "history, archaeology, ancient history",
  "🐾": "pets, animals, dogs, cats, wildlife",
  "🌦️": "weather, forecasts, meteorology",
  "🕊️": "religion, spirituality, faith, philosophy",
  "⚖️": "law, legal, courts, regulation",
  "🏢": "real estate, housing, mortgages, commercial property",
  "✈️": "aviation, airlines, flights, aircraft",
  "🚢": "shipping, maritime, logistics, ports",
  "🔌": "chips, semiconductors, hardware, electronics",
  "📊": "data, analytics, statistics, data visualization",
  "🖌️": "design tools, prototyping, figma, design systems",
  "📲": "mobile apps, ios, android, app development",
  "🦄": "startups, founders, entrepreneurship",
  "💰": "venture capital, funding, fundraising, private equity",
  "🔓": "open source, free software, github",
  "🌐": "web, browsers, internet, web standards, css",
  "🖱️": "UX, user experience, usability, interaction design",
  "🔤": "typography, fonts, type design, lettering",
  "🧊": "3D, modeling, rendering, cad, blender",
  "🥽": "AR, VR, XR, mixed reality, spatial computing, headsets",
  "⚛️": "quantum, quantum computing, physics",
  "🧬": "biotech, genetics, genomics, biology",
  "🧘": "mental health, meditation, mindfulness, therapy",
  "👶": "parenting, kids, children, family",
  "🧳": "travel, tourism, vacations, trips",
  "🛒": "retail, e-commerce, shopping, consumer brands",
  "🏦": "banking, fintech, payments, personal finance",
  "☕": "coffee, tea, drinks, wine, cocktails",
  "🎬": "movies, tv, streaming, cinema, television",
  "📣": "marketing, advertising, social media, branding",
  "🧮": "math, mathematics, puzzles",
  "🌌": "astronomy, cosmology, telescopes",
  "🛡️": "defense, military, war, weapons",
  "🏗️": "construction, infrastructure, civil engineering",
  "🏭": "manufacturing, industry, factories, supply chain",
  "🌾": "agriculture, farming, food supply",
  "🌊": "oceans, sea, marine life",
  "⛰️": "outdoors, hiking, mountains, camping",
  "🎲": "board games, tabletop, role-playing",
  "🧪": "chemistry, materials, pharma, drugs",
  "🦠": "pandemics, virology, epidemiology, vaccines",
  "🚆": "trains, rail, public transport, transit",
  "🚲": "cycling, bikes, micromobility, scooters",
  "👔": "careers, jobs, hiring, remote work",
  "🔧": "repair, diy, maker, tools",
  "☁️": "cloud, devops, servers, databases",
  "🐧": "linux, operating systems, kernels",
  "📡": "telecom, networking, 5g, wifi, broadband",
  "🔋": "batteries, charging, storage",
  "♿": "accessibility, disability, inclusive design",
  "🏋️": "fitness, gym, workouts, running, nutrition",
  "✨": "anything else",
};

/** The shipped topics' emoji, by the id their page has. */
export const BUILTIN_TOPIC_EMOJI: Readonly<Record<string, string>> = {
  design: "🎨",
  ai: "🤖",
  tech: "📱",
  world: "🌍",
  business: "💼",
  science: "🔬",
  culture: "🎭",
  sports: "⚽",
};

const CHOICES = Object.keys(TOPIC_EMOJIS);

/** Lowercase words of a text, a plural "s" dropped, so "startups" and "startup" are one word. */
const stems = (text: string): string[] =>
  (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).map((word) =>
    word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word,
  );

/** Every keyword phrase of every emoji but the catch-all, as stemmed words, with its emoji. */
const KEYWORDS = Object.entries(TOPIC_EMOJIS)
  .filter(([emoji]) => emoji !== "✨")
  .flatMap(([emoji, about]) => about.split(",").map((phrase) => ({ emoji, words: stems(phrase) })))
  .filter(({ words }) => words.length > 0);

/** True when `words` appear in `text` side by side, in order. */
const holdsPhrase = (text: string[], words: string[]): boolean =>
  text.some((_, at) => words.every((word, offset) => text[at + offset] === word));

/**
 * An emoji for a name with no help from Jev: a flag when it names a place, else the emoji whose
 * keyword it holds as whole words (the longest keyword wins, so "venture capital" beats "capital"),
 * else a fixed hash of the name.
 */
export function fallbackEmoji(name: string): string {
  const place = placeEmoji(name);
  if (place) return place;
  const text = stems(name);
  let best: { emoji: string; length: number } | undefined;
  for (const { emoji, words } of KEYWORDS) {
    const length = words.join(" ").length;
    if (length > (best?.length ?? 0) && holdsPhrase(text, words)) best = { emoji, length };
  }
  if (best) return best.emoji;
  let hash = 0;
  for (const char of name.toLowerCase())
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 1_000_003;
  return CHOICES[hash % (CHOICES.length - 1)] ?? "✨";
}

/** The emoji a topic shows: the one stored with it, the shipped one, else the name's fallback. */
export function topicEmoji(topic: {
  id: string;
  name: string;
  emoji?: string | undefined;
}): string {
  return topic.emoji ?? BUILTIN_TOPIC_EMOJI[topic.id] ?? fallbackEmoji(topic.name);
}
