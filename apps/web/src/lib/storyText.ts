import type { DigestItem } from "@dispatch/core";

/**
 * A story as the host says it, for the transcript of a briefing in the open player: the spoken
 * version when the digest has one (it already has its own lead-in), else the headline and the
 * summary as narration reads them, each a sentence. White space is one space.
 */
export function storyText(item: Pick<DigestItem, "headline" | "summary" | "spoken">): string {
  const spoken = item.spoken?.replace(/\s+/g, " ").trim();
  if (spoken) return spoken;
  const sentence = (text: string): string => {
    const trimmed = text
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[:;,]+$/, "");
    if (trimmed === "") return "";
    return /[.!?]["')\]]*$/.test(trimmed) ? trimmed : `${trimmed}.`;
  };
  return [sentence(item.headline), sentence(item.summary)].filter((part) => part !== "").join(" ");
}
