/**
 * npm run ds -- find "<what you need>" | part <id> | token <words> | list
 * Reads tokens/system.json, so it answers in milliseconds and never greps a stylesheet.
 */
import { existsSync, readFileSync } from "node:fs";
import { SYSTEM_PATH } from "./build.js";
import { answer, describePart, describeTokenLine, findTokens } from "./query.js";
import type { System } from "./types.js";

function load(): System {
  if (!existsSync(SYSTEM_PATH)) {
    console.error("tokens/system.json is missing. Run: npm run system");
    process.exit(1);
  }
  return JSON.parse(readFileSync(SYSTEM_PATH, "utf8")) as System;
}

const [command, ...rest] = process.argv.slice(2);
const argument = rest.join(" ").trim();
const system = load();

switch (command) {
  case "find":
    console.log(answer(system, argument));
    break;
  case "part": {
    if (argument === "bespoke") {
      for (const item of system.bespoke)
        console.log(
          `.${item.class}${item.part ? ` (use the ${item.part} part)` : " (not for reuse)"}: ${item.reason}`,
        );
      break;
    }
    const part = system.parts.find((candidate) => candidate.id === argument);
    if (!part) {
      console.error(`No part "${argument}". Parts: ${system.parts.map((p) => p.id).join(", ")}`);
      process.exit(1);
    }
    console.log(describePart(part));
    break;
  }
  case "token": {
    const exact = system.tokens.filter(
      (token) =>
        (token.tier !== "primitive" || token.type !== "color") &&
        (token.name === argument || token.name.startsWith(`--${argument}-`)),
    );
    const hits = exact.length > 0 ? exact : findTokens(system, argument, 8).map((hit) => hit.token);
    if (hits.length === 0) console.log(`No token matches "${argument}".`);
    for (const token of hits.slice(0, 40)) console.log(describeTokenLine(token));
    break;
  }
  case "list":
    for (const part of system.parts) console.log(`${part.id}: ${part.summary}`);
    break;
  default:
    console.error('Usage: npm run ds -- find "<need>" | part <id|bespoke> | token <words> | list');
    process.exit(command ? 1 : 0);
}
