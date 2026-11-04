import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  type Category,
  type Digest,
  digestRelPath,
  type PodcastRequest,
  type Section,
  serializeDigestFile,
} from "@singularity/core";
import { ScriptReply } from "../src/podcast/llmScriptWriter.js";
import type { ScriptInput, ScriptTurn, ScriptWriter, TurnRewrite } from "../src/podcast/types.js";

export const NOW = new Date("2026-10-08T07:13:00Z");

export interface StorySpec {
  n: number;
  section?: Section;
  category?: Category;
  headline?: string;
  summary?: string;
  url?: string;
  score?: number;
}

export function itemId(n: number): string {
  return n.toString(16).padStart(12, "0");
}

function digestItem(spec: StorySpec): Digest["items"][number] {
  return {
    id: itemId(spec.n),
    section: spec.section ?? "ai",
    category: spec.category ?? "frontier_model_releases",
    source_type: "rss",
    headline: spec.headline ?? `Model ${spec.n} ships with a new planner`,
    url: spec.url ?? `https://example.com/story-${spec.n}`,
    source: "Example Wire",
    summary:
      spec.summary ??
      `Example Wire reports that model ${spec.n} adds a planner. It cuts latency by 40 percent. The catch is that it needs a new runtime.`,
    score: spec.score ?? 0.8,
  };
}

/** A digest generated at `generatedAt`, padded to the schema's three-item floor with off-topic stories. */
export function makeDigest(id: string, generatedAt: string, specs: readonly StorySpec[]): Digest {
  const items = specs.map(digestItem);
  for (let pad = 0; items.length < 3; pad++) {
    items.push(
      digestItem({
        n: 0xf0000 + Number.parseInt(id.replace(/\D/g, "").slice(-6), 10) + pad,
        section: "watch",
        category: "taste_and_design_philosophy",
      }),
    );
  }
  return {
    id,
    date: id.slice(0, 10),
    kind: "regular",
    verified: true,
    generated_at: generatedAt,
    window: { from: "2026-09-01T00:00:00Z", to: generatedAt },
    read_minutes: 5,
    listen_minutes: 6,
    audio: null,
    cover: { template: "spring", palette: "dusk", seed: 1 },
    items,
  };
}

export async function writeDigest(root: string, digest: Digest): Promise<void> {
  const path = join(root, digestRelPath(digest.id));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serializeDigestFile(digest), "utf8");
}

export async function tempRoot(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "singularity-podcast-"));
  return {
    root,
    cleanup: () => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }),
  };
}

export const REQUEST: PodcastRequest = {
  topic_ids: ["ai"],
  length_minutes: 5,
  format: "readout",
  window_days: 7,
  tone: "neutral",
};

/** The id and timestamp of a digest generated `days` before NOW. */
export function dayAgo(days: number): { id: string; at: string } {
  const at = new Date(NOW.getTime() - days * 86_400_000);
  return { id: at.toISOString().slice(0, 10), at: at.toISOString() };
}

/**
 * A scripted ScriptWriter. `script` receives the input and the call number and returns the raw
 * reply; the default writes a valid script for the format. A reply to a call with an opening is a
 * whole script whose first turns stand for the opening, as the model's reply comes back with the
 * opening put in front of it. With `onTurns`, the reply's own turns stream one at a time.
 */
export class FakeScriptWriter implements ScriptWriter {
  readonly calls: Array<{ input: ScriptInput; problems: readonly string[] }> = [];
  readonly rewrites: TurnRewrite[] = [];
  private readonly script: (input: ScriptInput, call: number) => unknown;
  private readonly rewrite: (input: TurnRewrite) => string | null;

  constructor(
    script: (input: ScriptInput, call: number) => unknown = (input) => scriptOf(input),
    rewrite: (input: TurnRewrite) => string | null = () => null,
  ) {
    this.script = script;
    this.rewrite = rewrite;
  }

  async writeScript(input: ScriptInput, problems: readonly string[]): Promise<unknown> {
    this.calls.push({ input, problems });
    const reply = this.script(input, this.calls.length - 1);
    const parsed = ScriptReply.safeParse(reply);
    if (input.onTurns && parsed.success) {
      const own = parsed.data.turns.slice(input.opening?.length ?? 0);
      for (let count = 1; count <= own.length; count++) input.onTurns(own.slice(0, count));
    }
    return reply;
  }

  async rewriteTurn(input: TurnRewrite): Promise<string | null> {
    this.rewrites.push(input);
    return this.rewrite(input);
  }
}

/**
 * Filler per story turn that brings a default script to about 95% of its budget: over the 90% that
 * gets a continuation, under the budget that drops stories.
 */
export function padFor(input: ScriptInput, duo: boolean): string {
  const count = Math.max(1, input.stories.length * (duo ? 2 : 1));
  const bare = scriptOf(input, "").turns.reduce((sum, turn) => sum + turn.text.length, 0);
  // Each story turn gains a space and the fill, and "word " k times trimmed is 5k - 1 characters.
  const words = Math.floor((input.budget_chars * 0.95 - bare) / count / 5);
  return words > 0 ? "word ".repeat(words).trim() : "";
}

/**
 * A valid script: a hello, a rundown, a block per story, a close, a sign-off. `fill` pads every story turn. A
 * discussion opens with both hosts and gives each story an a-then-b pair, so the hosts alternate
 * from the first turn to the last.
 */
export function scriptOf(input: ScriptInput, explicitFill?: string): { turns: ScriptTurn[] } {
  const duo = input.request.format === "discussion";
  // Unless a test asks for a fill, pad to 95% of the budget so the length is met.
  const fill = explicitFill ?? padFor(input, duo);
  const turns: ScriptTurn[] = [
    { speaker: "a", text: "Welcome to Singularity. Here is what moved." },
  ];
  if (duo) turns.push({ speaker: "b", text: "Glad to be here. What have we got?" });
  if (input.request.format !== "headlines") {
    turns.push({ speaker: "a", text: "Coming up: the lead stories, then the quick news." });
    if (duo) turns.push({ speaker: "b", text: "Let us start with the biggest one." });
  }
  for (const story of input.stories) {
    const id = story.item_id;
    turns.push({ speaker: "a", text: `${story.headline}. ${fill}`.trim(), item_id: id });
    if (duo) turns.push({ speaker: "b", text: `What is the catch? ${fill}`.trim(), item_id: id });
  }
  if (input.request.format !== "headlines") {
    turns.push({ speaker: "a", text: "One question to carry out of this: what changes next?" });
    if (duo) turns.push({ speaker: "b", text: "That is the one to watch." });
  }
  turns.push({ speaker: "a", text: "That is Singularity for now." });
  return { turns };
}
