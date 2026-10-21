import type { Item } from "@dispatch/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AlexandriaConfig, createAlexandria } from "../src/alexandria/alexandria.js";
import { callsFromSpend } from "../src/cost/ledger.js";
import type { ExtractedText } from "../src/extract/extractText.js";
import { RequestMeter } from "../src/llm/requestMeter.js";
import { enrichThin } from "../src/run/writeStage.js";
import { makeItem } from "./score-factories.js";

const TITLE = "Acme Robotics raises Series B funding";
const config = AlexandriaConfig.parse({});

const tool = (description: string, extra: Record<string, unknown> = {}) => ({
  provider: "acme-data",
  capability: "companies/news",
  description,
  options: [{ name: "q", type: "string" }],
  response: { key: "news" },
  ...extra,
});

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/** A fake Firecrawl: discovery returns `tools`, execution returns `records` and `creditsCost`. */
function fakeFirecrawl(opts: { tools?: unknown[]; records?: unknown[]; creditsCost?: number }) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(url.replace("https://api.firecrawl.dev", ""));
    if (url.endsWith("/v2/search")) return json({ data: { tools: opts.tools ?? [] } });
    return json({
      data: {
        alexandria: [{ provider: "acme-data", data: { news: opts.records ?? [] } }],
        ...(opts.creditsCost === undefined ? {} : { creditsCost: opts.creditsCost }),
      },
    });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const related = [
  { title: "Acme Robotics closes Series B funding round", url: "https://data.example/acme" },
];

afterEach(() => vi.useRealTimers());

describe("Alexandria facts for a thin finalist", () => {
  it("labels the facts with their provider and drops records unrelated to the story", async () => {
    const { fetchImpl } = fakeFirecrawl({
      tools: [tool("Company news, 5 credits a call.")],
      records: [...related, { title: "Unrelated cooking recipe", url: "https://data.example/x" }],
      creditsCost: 5,
    });
    const facts = await createAlexandria({ apiKey: "k", config, fetchImpl }).factsFor({
      title: TITLE,
    });
    expect(facts).toContain("provider acme-data");
    expect(facts).toContain("Series B funding round");
    expect(facts).not.toContain("cooking");
  });

  it("is not asked for a story whose text is long enough, and fills in a story that would drop", async () => {
    const enrich = vi.fn(
      async () => "Alexandria facts (provider p)\n- title: Acme raised a round of money",
    );
    const item = makeItem({}) as Item;
    const long: ExtractedText = { text: "x".repeat(800), method: "readability", truncated: false };
    expect(await enrichThin({ enrich }, item, long)).toBe(long);
    expect(enrich).not.toHaveBeenCalled();

    const thin: ExtractedText = { text: "short teaser", method: "snippet", truncated: false };
    const merged = await enrichThin({ enrich }, item, thin);
    expect(merged?.text).toContain("short teaser");
    expect(merged?.text).toContain("Alexandria facts");

    const rescued = await enrichThin({ enrich: async () => "f".repeat(300) }, item, null);
    expect(rescued?.method).toBe("alexandria");
  });

  it("leaves the story as it was when the call fails or finds nothing", async () => {
    const item = makeItem({}) as Item;
    const thin: ExtractedText = { text: "short teaser", method: "snippet", truncated: false };
    const boom = async () => {
      throw new Error("down");
    };
    expect(await enrichThin({ enrich: boom }, item, thin)).toBe(thin);
    expect(await enrichThin({ enrich: async () => null }, item, null)).toBeNull();
    const failing = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    expect(
      await createAlexandria({ apiKey: "k", config, fetchImpl: failing }).factsFor({
        title: TITLE,
      }),
    ).toBeNull();
  });

  it("gives up after the time box instead of delaying the run", async () => {
    vi.useFakeTimers();
    const hang = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;
    const pending = createAlexandria({ apiKey: "k", config, fetchImpl: hang }).factsFor({
      title: TITLE,
    });
    await vi.advanceTimersByTimeAsync(config.timeout_ms + 1);
    expect(await pending).toBeNull();
  });

  it("never exceeds the story cap or the run cap", async () => {
    const dear = fakeFirecrawl({
      tools: [tool("Each page costs 30 Firecrawl credits.")],
      records: related,
    });
    const none = createAlexandria({ apiKey: "k", config, fetchImpl: dear.fetchImpl });
    expect(await none.factsFor({ title: TITLE })).toBeNull();
    expect(dear.calls).toEqual(["/v2/search"]);

    const cheap = fakeFirecrawl({
      tools: [tool("Costs 10 credits.")],
      records: related,
      creditsCost: 10,
    });
    const alexandria = createAlexandria({ apiKey: "k", config, fetchImpl: cheap.fetchImpl });
    for (let i = 0; i < 5; i++) await alexandria.factsFor({ title: TITLE });
    expect(alexandria.spent).toBe(30);
    expect(cheap.calls.filter((c) => c === "/v2/scrape")).toHaveLength(3);
  });

  it("stops asking once Firecrawl answers 429", async () => {
    let requests = 0;
    const limited = (async () => {
      requests += 1;
      return new Response("", { status: 429 });
    }) as unknown as typeof fetch;
    const alexandria = createAlexandria({ apiKey: "k", config, fetchImpl: limited });
    await alexandria.factsFor({ title: TITLE });
    await alexandria.factsFor({ title: TITLE });
    expect(requests).toBe(1);
  });
});

describe("Alexandria cost recording", () => {
  const base = { at: "2026-10-21T06:00:00Z", runId: "r", kind: "daily", timezone: "UTC" } as const;

  it("records reported credits as measured and unreported ones as estimated, in one record", async () => {
    const meter = new RequestMeter();
    const onCredits = (credits: number, estimated: boolean) =>
      meter.addUnits(
        "firecrawl",
        "alexandria",
        estimated ? "credits_estimated" : "credits",
        credits,
      );
    const measured = fakeFirecrawl({
      tools: [tool("Costs 5 credits.")],
      records: related,
      creditsCost: 4,
    });
    await createAlexandria({
      apiKey: "k",
      config,
      fetchImpl: measured.fetchImpl,
      onCredits,
    }).factsFor({
      title: TITLE,
    });
    expect(callsFromSpend({ requests: {}, units: meter.peekUnits() }, base)).toMatchObject([
      { provider: "firecrawl", product: "alexandria", units: { credits: 4 } },
    ]);

    const guessed = fakeFirecrawl({ tools: [tool("Costs 5 credits.")], records: related });
    await createAlexandria({
      apiKey: "k",
      config,
      fetchImpl: guessed.fetchImpl,
      onCredits,
    }).factsFor({
      title: TITLE,
    });
    const [call, ...rest] = callsFromSpend({ requests: {}, units: meter.peekUnits() }, base);
    expect(rest).toHaveLength(0);
    expect(call).toMatchObject({ units: { credits: 9 }, estimated: true });
  });
});
