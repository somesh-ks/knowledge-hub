/**
 * The emoji beside a topic on the Sources page. The shipped topics have a fixed one; a topic the
 * owner adds gets one from Jev (a choice among TOPIC_EMOJIS, so the answer is always one of these)
 * and, when Jev cannot answer, `fallbackEmoji`, which is the same for the same name every time.
 */

/** What each emoji stands for, as Jev is told it. The keys are the only answers it may give. */
export const TOPIC_EMOJIS: Readonly<Record<string, string>> = {
  "🎨": "art, design, creativity",
  "🤖": "AI, machine learning, robots",
  "📱": "phones, gadgets, consumer technology",
  "💻": "software, programming, developer tools",
  "🌍": "world affairs, geography, travel",
  "💼": "business, finance, work",
  "📈": "markets, economics, startups, investing",
  "🔬": "science, research, medicine",
  "🚀": "space, aviation, ambitious engineering",
  "🎭": "culture, film, theatre, books",
  "🎵": "music, audio, podcasts",
  "🎮": "games, game design",
  "⚽": "sports, fitness",
  "🍳": "food, cooking, restaurants",
  "🌱": "environment, climate, nature, gardening",
  "⚡": "energy, electric vehicles, power",
  "🏛️": "politics, law, government",
  "🎓": "education, learning, careers",
  "🔐": "security, privacy, cryptography",
  "📰": "news, media, journalism",
  "🏠": "home, architecture, property",
  "🧠": "psychology, thinking, productivity",
  "📷": "photography, video, film-making",
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

/** An emoji for a name with no help from Jev: by a word it holds, else by a fixed hash of it. */
export function fallbackEmoji(name: string): string {
  const text = name.toLowerCase();
  for (const [emoji, about] of Object.entries(TOPIC_EMOJIS)) {
    const words = about.split(/[ ,]+/).filter((word) => word.length > 3);
    if (words.some((word) => text.includes(word.slice(0, Math.max(4, word.length - 2)))))
      return emoji;
  }
  let hash = 0;
  for (const char of text) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 1_000_003;
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
