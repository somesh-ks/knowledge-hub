import { verifyPassphrase } from "@dispatch/core/passphrase";
import { planEpisodeNarration } from "@dispatch/engine/segments";
import { beforeAll, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { cheapPassphraseHash } from "../testing/cheapPassphraseHash";
import { createFakeBlobStore, FAKE_BLOB_HOST } from "../testing/fakeBlobStore";
import { createFakeSpeechify, FAKE_AUDIO } from "../testing/fakeSpeechify";
import { MS_PER_CHARACTER, type ServerEnv, withSecondVoice } from "./config";
import { NARRATE_DAILY_CAP } from "./limits";
import {
  type EpisodeBundle,
  handleNarrate,
  handleNarrationLookup,
  isEpisodeId,
  type NarrateBody,
  type NarrateDeps,
  parseDigestId,
  parseNarrateRequest,
  turnKey,
} from "./narrate";
import { segmentHash, segmentPath } from "./narrateSegments";
import { usageKey } from "./narrationState";

/**
 * Episodes through /api/narrate: one segment per turn, a voice per speaker, and nothing that a
 * briefing does that an episode may not. The briefing paths are covered in narrate.test.ts.
 */

const NOW = Date.parse("2026-10-07T12:00:00Z");
const ORIGIN = "https://news.someshks.work";
const MONTH = "2026-10";
const TODAY = "2026-10-07";
const ID = "ep-20261007-1930";
const PASSPHRASE = "correct horse battery staple";
const SPEECHIFY_KEY = "speechify-test-key-8f3a9c1e2b7d";
const BLOB_TOKEN = "vercel_blob_rw_teststore_0123456789abcdefghij";
/** The engine's default voice and model, and the second host's voice for these tests. */
const VOICE = "geffen_32";
const VOICE_B = "second_voice_7";
const MODEL = "simba-3.2";

let passphraseHash = "";

beforeAll(() => {
  passphraseHash = cheapPassphraseHash(PASSPHRASE);
});

interface Turn {
  idx: number;
  speaker: "a" | "b";
  text: string;
  item_id?: string;
}

const TURNS: Turn[] = [
  { idx: 0, speaker: "a", text: "Welcome back. Two stories today." },
  { idx: 1, speaker: "a", text: "First, a new model ships.", item_id: "s1" },
  { idx: 2, speaker: "b", text: "It is faster, and the catch is the price.", item_id: "s1" },
  { idx: 3, speaker: "a", text: "Second, a CSS feature lands.", item_id: "s2" },
  { idx: 4, speaker: "b", text: "A story the list does not carry.", item_id: "gone" },
  { idx: 5, speaker: "b", text: "Thanks for listening." },
];

function episodeFile(turns: Turn[] = TURNS, id = ID, request?: Record<string, unknown>): string {
  const front = stringify({
    id,
    title: "The week",
    generated_at: "2026-10-07T17:30:00.000Z",
    format: "discussion",
    ...(request ? { request } : {}),
    sources: [
      { item_id: "s1", url: "https://example.com/1", headline: "New model", source: "Example" },
      { item_id: "s2", url: "https://example.com/2", headline: "CSS feature", source: "Example" },
    ],
    turns,
  });
  return `---\n${front}---\n\nThe script.\n`;
}

const wholeChars = (turns: Turn[] = TURNS): number =>
  turns.reduce((sum, turn) => sum + turn.text.length, 0);

interface Options {
  env?: ServerEnv;
  files?: Map<string, string>;
  withBundle?: boolean;
}

function setup(options: Options = {}) {
  const clock = NOW;
  const blob = createFakeBlobStore(() => clock, { cdn: false });
  const speech = createFakeSpeechify();
  const files = options.files ?? new Map([[ID, episodeFile()]]);
  const episodes: EpisodeBundle = { readEpisode: async (id) => files.get(id) ?? null };
  const logs: string[] = [];
  const idle = new AbortController();
  const deps: NarrateDeps = {
    env: {
      GENERATE_PASSPHRASE_HASH: passphraseHash,
      SPEECHIFY_API_KEY: SPEECHIFY_KEY,
      BLOB_READ_WRITE_TOKEN: BLOB_TOKEN,
      ...options.env,
    },
    fetch: speech.fetch,
    now: () => clock,
    delay: async () => {},
    verifyPassphrase,
    openBlob: () => blob,
    digests: { readDigest: async () => null, readTimeline: async () => null },
    ...(options.withBundle === false ? {} : { episodes }),
    startDeadline: () => ({ signal: idle.signal, cancel: () => {} }),
    log: (message) => logs.push(message),
  };
  return { deps, blob, speech, logs, files };
}

type Context = ReturnType<typeof setup>;
type Result = Awaited<ReturnType<typeof handleNarrate>>;

const post = (context: Context, fields: Record<string, unknown> = {}, id = ID) =>
  handleNarrate(
    {
      bodyText: JSON.stringify({ digest: id, passphrase: PASSPHRASE, ...fields }),
      origin: ORIGIN,
      expectedOrigin: ORIGIN,
    },
    context.deps,
  );
const lookup = (context: Context, id: string | null = ID) =>
  handleNarrationLookup({ digest: id, params: id === null ? [] : ["digest"] }, context.deps);

function lookupBody(result: { body: NarrateBody }) {
  if (result.body.status !== 200 || !("segments" in result.body)) {
    throw new Error(`expected a lookup, got ${JSON.stringify(result.body)}`);
  }
  return result.body;
}

function segmentBody(result: Result) {
  if (result.body.status !== 200 || !("segment" in result.body)) {
    throw new Error(`expected a narrated segment, got ${JSON.stringify(result.body)}`);
  }
  return result.body.segment;
}

const pathOf = (turn: Turn, voice: string): string =>
  segmentPath(ID, turnKey(turn.idx), segmentHash(turn.text, voice, MODEL));

const TWO_VOICES = { SPEECHIFY_VOICE_ID_B: VOICE_B };

describe("episode ids", () => {
  it("are accepted by parseDigestId beside briefing ids, and nothing near them is", () => {
    expect(parseDigestId(ID)).toBe(ID);
    expect(parseDigestId("2026-10-07")).toBe("2026-10-07");
    expect(isEpisodeId(ID)).toBe(true);
    expect(isEpisodeId("2026-10-07")).toBe(false);
    for (const bad of ["ep-20261007-193", "ep-20261007-1930/../x", "EP-20261007-1930", "ep-1-2"]) {
      expect(parseDigestId(bad), bad).toBeNull();
    }
  });

  it("can be sent with a turn's segment key", () => {
    expect(turnKey(12)).toBe("t12");
    expect(
      parseNarrateRequest(JSON.stringify({ digest: ID, passphrase: PASSPHRASE, segment: "t12" })),
    ).toEqual({ digest: ID, passphrase: PASSPHRASE, segment: "t12" });
  });
});

describe("GET /api/narrate for an episode", () => {
  it("lists one segment per turn, each tied to its story or to none", async () => {
    const context = setup();
    const body = lookupBody(await lookup(context));
    expect(body.audio).toBeNull();
    expect(body.timeline).toBeNull();
    expect(body.ms_per_character).toBe(MS_PER_CHARACTER);
    expect(body.segments.map((segment) => [segment.key, segment.item_id])).toEqual([
      ["t0", null],
      ["t1", "s1"],
      ["t2", "s1"],
      ["t3", "s2"],
      // A turn about a story the episode does not list belongs to none.
      ["t4", null],
      ["t5", null],
    ]);
    expect(body.segments.map((segment) => segment.characters)).toEqual(
      TURNS.map((turn) => turn.text.length),
    );
  });

  it("gives each turn the address its voice would have, the second host's in the second voice", async () => {
    const context = setup({ env: TWO_VOICES });
    const { segments } = lookupBody(await lookup(context));
    for (const turn of TURNS) {
      const voice = turn.speaker === "b" ? VOICE_B : VOICE;
      expect(segments[turn.idx]?.audio).toMatchObject({
        url: `${FAKE_BLOB_HOST}/${pathOf(turn, voice)}`,
        confirmed: false,
      });
    }
  });

  it("falls back to the first voice for both hosts when no second voice is set", async () => {
    const context = setup();
    const { segments } = lookupBody(await lookup(context));
    for (const turn of TURNS) {
      expect(segments[turn.idx]?.audio?.url).toBe(`${FAKE_BLOB_HOST}/${pathOf(turn, VOICE)}`);
    }
  });

  it("uses the configured first voice for the first host", async () => {
    const context = setup({ env: { SPEECHIFY_VOICE_ID: "mine_1", ...TWO_VOICES } });
    const { segments } = lookupBody(await lookup(context));
    expect(segments[0]?.audio?.url).toBe(`${FAKE_BLOB_HOST}/${pathOf(TURNS[0] as Turn, "mine_1")}`);
    expect(segments[2]?.audio?.url).toBe(`${FAKE_BLOB_HOST}/${pathOf(TURNS[2] as Turn, VOICE_B)}`);
  });

  it("reads the voices the episode's request chose over the server's, a missing one from the server", async () => {
    const files = new Map([
      [ID, episodeFile(TURNS, ID, { topic_ids: ["x"], voice_id: "mine_1", voice_id_b: "other_2" })],
    ]);
    const context = setup({ env: { SPEECHIFY_VOICE_ID: "env_a", ...TWO_VOICES }, files });
    const { segments } = lookupBody(await lookup(context));
    expect(segments[0]?.audio?.url).toBe(`${FAKE_BLOB_HOST}/${pathOf(TURNS[0] as Turn, "mine_1")}`);
    expect(segments[2]?.audio?.url).toBe(
      `${FAKE_BLOB_HOST}/${pathOf(TURNS[2] as Turn, "other_2")}`,
    );

    const half = new Map([[ID, episodeFile(TURNS, ID, { topic_ids: ["x"], voice_id: "mine_1" })]]);
    const rest = lookupBody(await lookup(setup({ env: TWO_VOICES, files: half })));
    expect(rest.segments[2]?.audio?.url).toBe(
      `${FAKE_BLOB_HOST}/${pathOf(TURNS[2] as Turn, VOICE_B)}`,
    );
  });

  it("points every turn at the file the engine's publish stores for it, so a pre-narrated episode is never narrated again", async () => {
    // Padded text and a missing turn number: the two sides must read the file to the same words.
    const turns = [{ ...(TURNS[0] as Turn), text: "  Welcome back.\n" }, ...TURNS.slice(1)];
    const cases: { env: ServerEnv; request?: Record<string, unknown> }[] = [
      { env: {} },
      { env: { SPEECHIFY_VOICE_ID: "env_a", ...TWO_VOICES } },
      { env: TWO_VOICES, request: { topic_ids: ["x"], voice_id: "mine_1", voice_id_b: "other_2" } },
    ];
    for (const { env, request } of cases) {
      const file = episodeFile(turns, ID, request);
      const context = setup({ files: new Map([[ID, file]]) });
      // As the route runs it: the second voice is filled in when nothing sets it.
      context.deps.env = withSecondVoice({ ...context.deps.env, ...env });
      const { segments } = lookupBody(await lookup(context));
      const plan = planEpisodeNarration(file, env);
      expect(segments.map((segment) => segment.audio?.url)).toEqual(
        plan.segments.map((segment) => `${FAKE_BLOB_HOST}/${segment.path}`),
      );
    }
  });

  it("synthesizes with the episode's voices and ignores a voice in the request body", async () => {
    const files = new Map([
      [ID, episodeFile(TURNS, ID, { topic_ids: ["x"], voice_id: "mine_1", voice_id_b: "other_2" })],
    ]);
    const context = setup({ files });
    await post(context, { segment: "t1", voice_id: "sneaky" });
    await post(context, { segment: "t2", voice_id: "sneaky" });
    expect(context.speech.calls.map((call) => call.body.voice_id)).toEqual(["mine_1", "other_2"]);
    const state = JSON.parse(context.blob.text(usageKey(MONTH)) ?? "null");
    expect(state.digests[ID].voice).toBe("mine_1+other_2");
  });

  it("ignores a voice id in the file that is not a voice id", async () => {
    const files = new Map([
      [ID, episodeFile(TURNS, ID, { topic_ids: ["x"], voice_id: "two words!" })],
    ]);
    const { segments } = lookupBody(await lookup(setup({ files })));
    expect(segments[0]?.audio?.url).toBe(`${FAKE_BLOB_HOST}/${pathOf(TURNS[0] as Turn, VOICE)}`);
  });

  it("asks the store nothing, and may be cached for a minute", async () => {
    const context = setup({ env: TWO_VOICES });
    const result = await lookup(context);
    expect(result.headers).toEqual({ "Cache-Control": "public, s-maxage=60" });
    expect(context.blob.calls).toEqual([]);
  });

  it("answers 404 for an episode this build does not have, and when it has no episodes at all", async () => {
    expect(await lookup(setup(), "ep-20200101-0000")).toEqual({
      status: 404,
      body: { status: 404, error: "digest_not_found" },
    });
    expect(await lookup(setup({ withBundle: false }))).toEqual({
      status: 404,
      body: { status: 404, error: "digest_not_found" },
    });
  });

  it("answers 422 for a file that cannot be read aloud, and 503 for an unusable second voice", async () => {
    const broken = setup({ files: new Map([[ID, "no frontmatter"]]) });
    expect(await lookup(broken)).toEqual({
      status: 422,
      body: { status: 422, error: "not_narratable" },
    });
    const misnamed = setup({ files: new Map([[ID, episodeFile(TURNS, "ep-20200101-0000")]]) });
    expect((await lookup(misnamed)).status).toBe(422);
    const badVoice = setup({ env: { SPEECHIFY_VOICE_ID_B: "not a voice!" } });
    expect(await lookup(badVoice)).toEqual({
      status: 503,
      body: { status: 503, error: "unavailable" },
    });
  });
});

describe("POST /api/narrate for an episode", () => {
  it("narrates the first host's turn in the first voice and charges the whole episode once", async () => {
    const context = setup({ env: TWO_VOICES });
    const turn = TURNS[1] as Turn;
    const result = await post(context, { segment: turnKey(turn.idx) });
    const narrated = segmentBody(result);
    expect(narrated).toMatchObject({
      key: "t1",
      item_id: "s1",
      characters: turn.text.length,
      audio: { url: `${FAKE_BLOB_HOST}/${pathOf(turn, VOICE)}`, confirmed: true },
    });
    expect(context.speech.calls).toHaveLength(1);
    expect(context.speech.calls[0]?.body).toMatchObject({ input: turn.text, voice_id: VOICE });
    expect(context.blob.bytes(pathOf(turn, VOICE))).toEqual(FAKE_AUDIO);

    // The whole script is charged ahead, under the pair of voices.
    expect(JSON.parse(context.blob.text(usageKey(MONTH)) ?? "null")).toEqual({
      version: 1,
      speechify: { month: MONTH, characters: wholeChars() },
      digests: {
        [ID]: {
          day: TODAY,
          characters: wholeChars(),
          voice: `${VOICE}+${VOICE_B}`,
          whole: false,
          segments: true,
        },
      },
    });
  });

  it("reads the second host's turn in the second voice, without charging again", async () => {
    const context = setup({ env: TWO_VOICES });
    await post(context, { segment: "t1" });
    const turn = TURNS[2] as Turn;
    const narrated = segmentBody(await post(context, { segment: "t2" }));
    expect(narrated.audio.url).toBe(`${FAKE_BLOB_HOST}/${pathOf(turn, VOICE_B)}`);
    expect(context.speech.calls.map((call) => call.body.voice_id)).toEqual([VOICE, VOICE_B]);
    expect(
      context.blob.changes().filter((change) => change === `put ${usageKey(MONTH)}`),
    ).toHaveLength(1);
  });

  it("reads both hosts in the first voice when no second voice is set, and charges under that voice", async () => {
    const context = setup();
    await post(context, { segment: "t2" });
    expect(context.speech.calls[0]?.body.voice_id).toBe(VOICE);
    const state = JSON.parse(context.blob.text(usageKey(MONTH)) ?? "null");
    expect(state.digests[ID].voice).toBe(VOICE);
  });

  it("gives two identical lines of the two hosts two different files", async () => {
    const same: Turn[] = [
      { idx: 0, speaker: "a", text: "Right." },
      { idx: 1, speaker: "b", text: "Right." },
    ];
    const context = setup({ env: TWO_VOICES, files: new Map([[ID, episodeFile(same)]]) });
    const first = segmentBody(await post(context, { segment: "t0" }));
    const second = segmentBody(await post(context, { segment: "t1" }));
    expect(first.audio.url).not.toBe(second.audio.url);
  });

  it("does not narrate a turn that is already narrated, and spends nothing on it", async () => {
    const context = setup({ env: TWO_VOICES });
    const turn = TURNS[3] as Turn;
    context.blob.seed(pathOf(turn, VOICE), new Uint8Array(16_000), NOW - 3_600_000);
    const narrated = segmentBody(await post(context, { segment: "t3" }));
    expect(narrated.audio.confirmed).toBe(true);
    expect(context.speech.calls).toHaveLength(0);
    expect(context.blob.changes()).toEqual([]);
  });

  it("narrates a turn again when the second voice changes", async () => {
    const before = setup({ env: TWO_VOICES });
    await post(before, { segment: "t2" });
    const after = setup({ env: { SPEECHIFY_VOICE_ID_B: "another_voice" } });
    const turn = TURNS[2] as Turn;
    expect(segmentBody(await post(after, { segment: "t2" })).audio.url).not.toBe(
      `${FAKE_BLOB_HOST}/${pathOf(turn, VOICE_B)}`,
    );
  });

  it("refuses a turn the episode does not have, before any store or speech call", async () => {
    const context = setup({ env: TWO_VOICES });
    expect(await post(context, { segment: "t99" })).toEqual({
      status: 404,
      body: { status: 404, error: "segment_not_found" },
    });
    expect(await post(context, { segment: "intro" })).toEqual({
      status: 404,
      body: { status: 404, error: "segment_not_found" },
    });
    expect(context.speech.calls).toHaveLength(0);
    expect(context.blob.changes()).toEqual([]);
  });

  it("refuses an episode this build does not have", async () => {
    const context = setup();
    expect(await post(context, { segment: "t0" }, "ep-20200101-0000")).toEqual({
      status: 404,
      body: { status: 404, error: "digest_not_found" },
    });
    const bare = setup({ withBundle: false });
    expect((await post(bare, { segment: "t0" })).status).toBe(404);
    expect(context.speech.calls).toHaveLength(0);
  });

  it("does not make a whole-episode file", async () => {
    const context = setup({ env: TWO_VOICES });
    expect(await post(context)).toEqual({
      status: 422,
      body: { status: 422, error: "not_narratable" },
    });
    expect(context.speech.calls).toHaveLength(0);
    expect(context.blob.changes()).toEqual([]);
  });

  it("counts an episode toward the day's cap of newly narrated pieces", async () => {
    const context = setup();
    const crowded = {
      "2026-10-01": { day: TODAY, characters: 300 },
      "2026-10-02": { day: TODAY, characters: 300 },
      "2026-10-03": { day: TODAY, characters: 300 },
    };
    expect(NARRATE_DAILY_CAP).toBe(3);
    context.blob.seed(
      usageKey(MONTH),
      JSON.stringify({
        version: 1,
        speechify: { month: MONTH, characters: 900 },
        digests: crowded,
      }),
    );
    const refused = await post(context, { segment: "t0" });
    expect(refused.status).toBe(429);
    expect(context.speech.calls).toHaveLength(0);
  });

  it("never lets a secret reach the answer or the log", async () => {
    const context = setup({ env: TWO_VOICES });
    const results = [
      await post(context, { segment: "t1" }),
      await post(context, { segment: "t99" }),
      await post(context),
    ];
    const everything = JSON.stringify(results) + context.logs.join("\n");
    for (const secret of [SPEECHIFY_KEY, BLOB_TOKEN, passphraseHash, PASSPHRASE]) {
      expect(everything).not.toContain(secret);
    }
  });
});
