import { describe, expect, it } from "vitest";
import { planPodcast } from "../src/podcast/plan.js";
import { scriptSystemPrompt } from "../src/podcast/prompt.js";
import type { ScriptInput } from "../src/podcast/types.js";
import { REQUEST } from "./podcast-fixtures.js";

function promptFor(format: "readout" | "discussion" | "headlines"): string {
  const request = { ...REQUEST, format };
  const plan = planPodcast(request);
  const input: ScriptInput = { request, stories: [], budget_chars: plan.budget_chars };
  return scriptSystemPrompt(input, "BOUNDARY");
}

describe("the hosts' names in the writer's prompt", () => {
  it("names Ada as the one host of a readout and of headlines", () => {
    expect(promptFor("readout")).toContain("One host, Ada");
    expect(promptFor("headlines")).toContain("One host, Ada");
  });

  it("names Ada and Leo in a discussion, and says Ada introduces Leo", () => {
    const prompt = promptFor("discussion");
    expect(prompt).toContain('Ada, speaker "a", leads; Leo, speaker "b", reacts');
    expect(prompt).toContain("joined by Leo");
  });
});
