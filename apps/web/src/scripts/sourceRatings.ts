/**
 * Lays the current ratings over a Sources page. The page is prerendered with the ratings of its build,
 * and the engine commits new stats after every run without a deploy, so the page asks /api/source-ratings
 * (held at the edge, server/sourceRatings.ts) and redraws each row's score. A failed or offline read
 * leaves the built page as it is.
 */
import { bandOf, element, starNode } from "./topicsView";

export interface Rating {
  score: number | null;
  label: string;
  parts: { health: number; quality: number; trust: number | null } | null;
  why: string[];
}

/** The edit panel's facts for a row (data-edit-source), with a rating's fields replaced. */
export function withRating(facts: string, rating: Rating): string {
  try {
    const parsed = JSON.parse(facts) as Record<string, unknown>;
    return JSON.stringify({
      ...parsed,
      score: rating.score,
      label: rating.label,
      parts: rating.parts,
      why: rating.why,
    });
  } catch {
    return facts;
  }
}

/** What ScoreMeter.astro draws inside `.score`, for a rating. */
function scoreContents(rating: Rating): Node[] {
  if (rating.label === "New" || rating.score === null) return [element("span", "score-new", "New")];
  const number = rating.score.toFixed(1);
  const shown = element("span", "score-number", number);
  shown.setAttribute("aria-hidden", "true");
  return [starNode(), shown, element("span", "sr-only", `Rated ${number} of 5, ${rating.label}`)];
}

function lay(row: HTMLElement, rating: Rating): void {
  row.dataset.band = bandOf(rating.score);
  row.dataset.score = String(rating.score ?? -1);
  const score = row.querySelector<HTMLElement>(".score");
  if (score) {
    score.dataset.label = rating.label;
    score.title =
      rating.score === null ? "Not scored yet" : `${rating.score.toFixed(1)} of 5, ${rating.label}`;
    score.replaceChildren(...scoreContents(rating));
  }
  const edit = row.querySelector<HTMLElement>("[data-edit-source]");
  if (edit?.dataset.editSource)
    edit.dataset.editSource = withRating(edit.dataset.editSource, rating);
}

export async function layRatings(root: ParentNode): Promise<void> {
  if (!navigator.onLine) return;
  const rows = [...root.querySelectorAll<HTMLElement>("li.source-row[data-id]")];
  if (rows.length === 0) return;
  try {
    const answer = await fetch("/api/source-ratings");
    if (!answer.ok) return;
    const { ratings } = (await answer.json()) as { ratings?: Record<string, Rating> };
    for (const row of rows) {
      const rating = row.dataset.id ? ratings?.[row.dataset.id] : undefined;
      if (rating) lay(row, rating);
    }
  } catch {
    // The built page stands.
  }
}
