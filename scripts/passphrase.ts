// Creates the scrypt hash for the Generate button passphrase and stores it in .env.
// The passphrase is typed into a muted prompt; neither it nor the hash is printed.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline";
import { hashPassphrase } from "@dispatch/core/passphrase";

const ENV_PATH = ".env";
const KEY = "GENERATE_PASSPHRASE_HASH";

function promptMuted(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: stdin, output: stdout, terminal: true });
    // Mute echo: readline writes typed characters through this method.
    const muted = rl as unknown as { _writeToOutput: (text: string) => void };
    muted._writeToOutput = () => {};
    stdout.write(question);
    rl.question("", (answer) => {
      rl.close();
      stdout.write("\n");
      resolve(answer);
    });
  });
}

async function main(): Promise<void> {
  const first = await promptMuted("New passphrase (8 or more characters): ");
  const second = await promptMuted("Repeat it: ");
  if (first !== second) {
    console.error("The two entries do not match. Nothing was changed.");
    process.exitCode = 1;
    return;
  }
  const hash = await hashPassphrase(first);
  const line = `${KEY}=${hash}`;
  const current = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  const pattern = new RegExp(`^${KEY}=.*$`, "m");
  const next = pattern.test(current)
    ? current.replace(pattern, line)
    : `${current}${current.endsWith("\n") || current === "" ? "" : "\n"}${line}\n`;
  writeFileSync(ENV_PATH, next);
  console.log(`Saved ${KEY} to ${ENV_PATH}. Run "npm run secrets:push" to send it to Vercel.`);
}

void main();
