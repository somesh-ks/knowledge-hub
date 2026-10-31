// Makes the Web Push key pair (D284) and writes it to the gitignored .env, printing no value.
// Usage: npm run vapid:keys   (then: npm run secrets:push)
// Keeps a pair that is already there: rotating it would end every subscription made with it.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import webpush from "web-push";

const SUBJECT = "https://news.someshks.work";

function main(): void {
  const envPath = resolve(".env");
  if (!existsSync(envPath)) {
    console.error("No .env found. Copy .env.example to .env first.");
    process.exitCode = 1;
    return;
  }
  const text = readFileSync(envPath, "utf8");
  const has = (name: string): boolean => new RegExp(`^${name}=\\S`, "m").test(text);
  if (has("VAPID_PUBLIC_KEY") && has("VAPID_PRIVATE_KEY")) {
    console.log("VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are already in .env: kept.");
    return;
  }
  if (has("VAPID_PUBLIC_KEY") !== has("VAPID_PRIVATE_KEY")) {
    console.error("Only one of the pair is in .env. Remove it, then run this again.");
    process.exitCode = 1;
    return;
  }
  const keys = webpush.generateVAPIDKeys();
  const lead = text.endsWith("\n") || text === "" ? "" : "\n";
  appendFileSync(
    envPath,
    `${lead}\n# Web Push (D284), made by npm run vapid:keys.\nVAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\n${has("VAPID_SUBJECT") ? "" : `VAPID_SUBJECT=${SUBJECT}\n`}`,
  );
  console.log("Wrote VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT to .env.");
  console.log("Next: npm run secrets:push");
}

main();
