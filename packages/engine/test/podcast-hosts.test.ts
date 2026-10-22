import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  episodeRelPath,
  HOST_NAME_POOLS,
  hostNamesFor,
  type PodcastRequest,
  parseEpisodeFile,
} from "@dispatch/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makePodcastCommand } from "../src/commands/podcast.js";
import { buildEpisode, writeEpisodeFile } from "../src/podcast/episode.js";
import { generateEpisode, withHostNames } from "../src/podcast/generate.js";
import { planPodcast } from "../src/podcast/plan.js";
import { scriptSystemPrompt } from "../src/podcast/prompt.js";
import type { ScriptInput } from "../src/podcast/types.js";
import { captureStdout, makeContext } from "./curate-helpers.js";
import { commitAll, createRepoPair, type RepoPair } from "./git-testRepo.js";
import {
  dayAgo,
  FakeScriptWriter,
  makeDigest,
  NOW,
  REQUEST,
  tempRoot,
  writeDigest,
} from "./podcast-fixtures.js";

const NAMES = { a: "Nora", b: "Owen" };
const DISCUSSION: PodcastRequest = { ...REQUEST, format: "discussion" };
const SOLO_HOST =
  'One host, speaker "a" only. The host never says a name for themselves, so write none.';

function promptFor(request: PodcastRequest): string {
  const plan = planPodcast(request);
  const input: ScriptInput = { request, stories: [], budget_chars: plan.budget_chars };
  return scriptSystemPrompt(input);
}

/** Two digests in the window, four stories in the request's one topic. */
async function seedDigests(root: string): Promise<void> {
  for (const days of [1, 2]) {
    const when = dayAgo(days);
    await writeDigest(root, makeDigest(when.id, when.at, [{ n: days * 10 }, { n: days * 10 + 1 }]));
  }
}

describe("the hosts' names in the writer's prompt", () => {
  it("names no one in a readout or headlines: the one host says no name", () => {
    for (const format of ["readout", "headlines"] as const) {
      const prompt = promptFor({ ...REQUEST, format, host_names: NAMES });
      expect(prompt).toContain(`FORMAT: ${format}. ${SOLO_HOST}`);
      expect(prompt).not.toMatch(/\b(Ada|Leo|Nora|Owen)\b/);
    }
  });

  it("names the hosts the request carries in a discussion, and says who is joining", () => {
    const prompt = promptFor({ ...DISCUSSION, host_names: NAMES });
    expect(prompt).toContain('Two hosts: Nora, speaker "a", leads; Owen, speaker "b", reacts.');
    expect(prompt).toContain(
      'The first turn is "a": the one-line hello, saying the show is Singularity and that Owen is joining.',
    );
    expect(prompt).toContain("The hosts may call each other by name now and then");
    expect(prompt).not.toMatch(/\b(Ada|Leo)\b/);
  });

  it("falls back to the gender-neutral pair when the request names no hosts", () => {
    const fallback = hostNamesFor(null, null);
    expect(HOST_NAME_POOLS.neutral).toEqual(expect.arrayContaining([fallback.a, fallback.b]));
    const prompt = promptFor(DISCUSSION);
    expect(prompt).toContain(
      `Two hosts: ${fallback.a}, speaker "a", leads; ${fallback.b}, speaker "b", reacts.`,
    );
    expect(prompt).toContain(`that ${fallback.b} is joining`);
  });

  it("assumes no host's gender in any format", () => {
    for (const format of ["readout", "discussion", "headlines"] as const) {
      const prompt = promptFor({ ...REQUEST, format, host_names: NAMES });
      expect(prompt).not.toMatch(/\b(she|he|her|hers|herself|him|his|himself)\b/i);
    }
    expect(promptFor({ ...DISCUSSION, host_names: NAMES })).toContain(
      "Refer to a host by name, never with a gendered pronoun.",
    );
  });
});

describe("withHostNames", () => {
  it("keeps a discussion's names and gives one without them the neutral pair", () => {
    expect(withHostNames({ ...DISCUSSION, host_names: NAMES }).host_names).toEqual(NAMES);
    expect(withHostNames(DISCUSSION).host_names).toEqual(hostNamesFor(null, null));
  });

  it("leaves the names out of a readout and of headlines", () => {
    expect(withHostNames({ ...REQUEST, host_names: NAMES })).toEqual(REQUEST);
    expect(
      withHostNames({ ...REQUEST, format: "headlines", host_names: NAMES }),
    ).not.toHaveProperty("host_names");
  });
});

describe("the names an episode is written with", () => {
  let ctx: Awaited<ReturnType<typeof tempRoot>>;
  beforeEach(async () => {
    ctx = await tempRoot();
    await seedDigests(ctx.root);
  });
  afterEach(async () => {
    await ctx.cleanup();
  });

  async function generate(request: PodcastRequest) {
    const writer = new FakeScriptWriter();
    const result = await generateEpisode({
      root: ctx.root,
      request,
      now: NOW,
      makeWriter: () => writer,
      dryRun: true,
    });
    const input = writer.calls[0]?.input;
    if (!input) throw new Error("The writer was not called");
    return { result, input };
  }

  it("gives the writer the request's names and stores them in the episode file", async () => {
    const { result, input } = await generate({ ...DISCUSSION, host_names: NAMES });
    expect(input.request.host_names).toEqual(NAMES);
    expect(scriptSystemPrompt(input)).toContain('Two hosts: Nora, speaker "a", leads; Owen');
    expect(result.episode.request.host_names).toEqual(NAMES);
    expect(parseEpisodeFile(result.markdown ?? "").request.host_names).toEqual(NAMES);
  });

  it("stores the neutral pair it wrote a discussion with when the request named no hosts", async () => {
    const fallback = hostNamesFor(null, null);
    const { result, input } = await generate(DISCUSSION);
    expect(input.request.host_names).toEqual(fallback);
    expect(scriptSystemPrompt(input)).toContain(`Two hosts: ${fallback.a}, speaker "a"`);
    expect(parseEpisodeFile(result.markdown ?? "").request.host_names).toEqual(fallback);
  });

  it("stores no names for a readout, even when the request carries some", async () => {
    const { result, input } = await generate({ ...REQUEST, host_names: NAMES });
    expect(input.request).not.toHaveProperty("host_names");
    expect(result.episode.request).not.toHaveProperty("host_names");
    expect(result.markdown).not.toContain("host_names");
  });
});

describe("a regenerated discussion", () => {
  const OLD_ID = "ep-20261008-0913";
  const NEW_ID = "ep-20261008-1013";
  const LATER = new Date(NOW.getTime() + 3_600_000);
  let pair: RepoPair;

  beforeEach(async () => {
    pair = await createRepoPair({ seedDigest: false });
    await seedDigests(pair.a);
    await commitAll(pair.a, "chore: seed digests");
  });
  afterEach(async () => {
    await pair.cleanup();
  });

  async function run(request: unknown, at: Date, writer = new FakeScriptWriter()) {
    const { ctx } = makeContext(pair.a, { json: false });
    const command = makePodcastCommand({ makeWriter: () => writer });
    const argv = ["--request", JSON.stringify(request), "--now", at.toISOString(), "--no-push"];
    const { result } = await captureStdout(() => command(argv, ctx));
    return { code: result, writer };
  }

  const stored = async (id: string) =>
    parseEpisodeFile(await readFile(join(pair.a, episodeRelPath(id)), "utf8")).request;

  const regenerate = { action: "regenerate", id: OLD_ID, feedback: "Shorter, please" };

  it("keeps the names its stored request has", async () => {
    expect((await run({ ...DISCUSSION, host_names: NAMES }, NOW)).code).toBe(0);
    expect((await stored(OLD_ID)).host_names).toEqual(NAMES);
    const { code, writer } = await run(regenerate, LATER);
    expect(code).toBe(0);
    expect(writer.calls[0]?.input.request.host_names).toEqual(NAMES);
    expect((await stored(NEW_ID)).host_names).toEqual(NAMES);
  });

  it("gets the neutral pair when its stored request has none", async () => {
    // An episode written before the names were stored: its request has none.
    const legacy = await buildEpisode({
      root: pair.a,
      id: OLD_ID,
      now: NOW,
      request: DISCUSSION,
      stories: [],
      turns: [
        { speaker: "a", text: "Welcome to Singularity. I am joined by Leo." },
        { speaker: "b", text: "Glad to be here." },
      ],
    });
    await writeEpisodeFile(pair.a, legacy);
    await commitAll(pair.a, `feat(podcast): add ${OLD_ID}`);
    expect(await stored(OLD_ID)).not.toHaveProperty("host_names");

    const { code, writer } = await run(regenerate, LATER);
    expect(code).toBe(0);
    expect(writer.calls[0]?.input.request.host_names).toEqual(hostNamesFor(null, null));
    expect((await stored(NEW_ID)).host_names).toEqual(hostNamesFor(null, null));
  });
});
