import { CATEGORIES } from "@dispatch/core";
import { describe, expect, it } from "vitest";
import type { HttpClient } from "../http.js";
import { applyOpsToDocuments } from "./applyDocuments.js";

const PREFERENCES = JSON.stringify({
  profile: "",
  focus: "",
  weights: Object.fromEntries(CATEGORIES.map((category) => [category, 0.5])),
  preferred_keywords: [],
  preferred_authors: [],
  disliked_patterns: [],
  feedback_history: [],
});

function failingHttp(error: unknown): HttpClient {
  const fail = async () => {
    throw error;
  };
  return { fetchText: fail, getJson: fail, postJson: fail };
}

const addSource = (http: HttpClient) =>
  applyOpsToDocuments({
    ops: { op: "source.add", url: "https://blog.example.com/" },
    documents: [{ path: "config/preferences.json", content: PREFERENCES, version: 1 }],
    baseFiles: { "config/sources.json": JSON.stringify({ version: 1, sources: [] }) },
    discover: { http },
  });

describe("applyOpsToDocuments: source.add in the function", () => {
  // The bug: the site's own network failing (no answer, a timeout) was answered 400, "the server
  // turned that change down", so the page dropped an address that was fine and never retried it.
  it("is retryable when the lookup fails on our side, and a refusal when the address answers 404", async () => {
    const network = await addSource(failingHttp(new Error("socket hang up")));
    expect(network).toMatchObject({ ok: false, retryable: true });

    const missing = await addSource(
      failingHttp(Object.assign(new Error("HTTP 404"), { status: 404 })),
    );
    expect(missing).toMatchObject({ ok: false, retryable: false });
  });
});
