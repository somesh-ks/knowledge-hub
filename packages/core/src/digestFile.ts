import { parse, stringify } from "yaml";
import { Digest, digestSections } from "./digest.js";
import { longDate } from "./time.js";

const FENCE = "---";

/** Serialize a digest: YAML frontmatter plus a generated Markdown body for editors and GitHub. */
export function serializeDigestFile(digest: Digest): string {
  const valid = Digest.parse(digest);
  const front = stringify(valid, { lineWidth: 0 }).trimEnd();
  return `${FENCE}\n${front}\n${FENCE}\n\n${renderBody(valid)}\n`;
}

/** Parse a digest file. The body is ignored: the frontmatter is the source of truth. */
export function parseDigestFile(text: string): Digest {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith(`${FENCE}\n`)) throw new Error("Digest file has no frontmatter");
  const end = normalized.indexOf(`\n${FENCE}\n`, FENCE.length);
  if (end < 0) throw new Error("Digest frontmatter is not closed");
  const raw: unknown = parse(normalized.slice(FENCE.length + 1, end));
  return Digest.parse(raw);
}

function renderBody(digest: Digest): string {
  const lines: string[] = [
    `# ${longDate(digest.date)}`,
    "",
    `${digest.items.length} items. ${digest.read_minutes} min read, ${digest.listen_minutes} min listen.`,
  ];
  for (const section of digestSections(digest)) {
    const items = digest.items.filter((item) => item.section === section.id);
    lines.push("", `## ${section.title}`);
    for (const item of items) {
      const byline = [item.source, item.author].filter(Boolean).join(", ");
      lines.push("", `### [${item.headline}](${item.url})`, byline, "", item.summary);
      if (item.why) lines.push("", `Why: ${item.why}`);
    }
  }
  return lines.join("\n");
}
