import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * What the Experiments page lists: a feature built but not yet trusted. To add one, add a line
 * here; the page draws it. A state with a `flag` is read from that file's boolean at build time, so
 * it cannot drift from the config; an entry with none says its own.
 */
export interface Experiment {
  id: string;
  name: string;
  /** What it does, in one line. */
  line: string;
  /** Where it is switched, as the owner would look for it. */
  switch: string;
  /** The boolean that turns it on. */
  flag?: { file: string; key: string };
  /** The state it holds while off, or always when it has no flag: a shadow logs what it would do. */
  rest: "off" | "shadow";
}

export type ExperimentState = "on" | "shadow" | "off";

export const EXPERIMENTS: readonly Experiment[] = [
  {
    id: "trusted-publishers",
    name: "Trusted publishers",
    line: "Lets a lab's own announcement pass the bar.",
    switch: "config/trusted-publishers.json",
    flag: { file: "config/trusted-publishers.json", key: "enabled" },
    rest: "shadow",
  },
  {
    id: "community-ranking",
    name: "Community ranking",
    line: "Lifts stories people vote up and argue over.",
    switch: "config/community.json",
    flag: { file: "config/community.json", key: "enabled" },
    rest: "shadow",
  },
  {
    id: "alexandria",
    name: "Alexandria facts",
    line: "Fills a thin story with facts from Firecrawl's data catalogue.",
    switch: "config/alexandria.json",
    flag: { file: "config/alexandria.json", key: "enabled" },
    rest: "off",
  },
  {
    id: "ingest",
    name: "Continuous ingest",
    line: "Reads the sources three times a day into the store, ahead of the daily.",
    switch: ".github/workflows/ingest.yml",
    rest: "shadow",
  },
];

export const stateOf = (experiment: Experiment, flagOn: boolean | undefined): ExperimentState =>
  flagOn ? "on" : experiment.rest;

/** A flag's value from its file. Throws when the file or the key is gone, so a rename fails the build. */
export async function readFlag(
  root: string,
  flag: { file: string; key: string },
): Promise<boolean> {
  const json = JSON.parse(await readFile(join(root, flag.file), "utf8")) as Record<string, unknown>;
  const value = json[flag.key];
  if (typeof value !== "boolean") throw new Error(`${flag.file} has no boolean "${flag.key}"`);
  return value;
}

export interface ExperimentRow extends Experiment {
  state: ExperimentState;
}

export async function loadExperiments(root: string): Promise<ExperimentRow[]> {
  return Promise.all(
    EXPERIMENTS.map(async (experiment) => ({
      ...experiment,
      state: stateOf(
        experiment,
        experiment.flag ? await readFlag(root, experiment.flag) : undefined,
      ),
    })),
  );
}
