import type { Env } from "@dispatch/core";

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

/** What every command receives. Commands never read process.env or the cwd directly. */
export interface CommandContext {
  /** Absolute repository root. */
  root: string;
  env: Env;
  log: Logger;
  /** True when output must be machine-readable JSON on stdout. */
  json: boolean;
  now: () => Date;
}

/** A command returns a process exit code: 0 success, 1 failure, 2 usage error. */
export type CommandRun = (argv: string[], ctx: CommandContext) => Promise<number>;

const MIN_SECRET_LENGTH = 8;

/** Replace every known secret value in text with a marker. */
export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length >= MIN_SECRET_LENGTH) out = out.split(secret).join("[redacted]");
  }
  return out;
}

/** Secret values to redact from logs, taken from the typed environment. */
export function secretsFromEnv(env: Env): string[] {
  const keys = [
    env.TYPESAFE_API_KEY,
    env.NEBIUS_API_KEY,
    env.EXA_API_KEY,
    env.FIRECRAWL_API_KEY,
    env.SPEECHIFY_API_KEY,
    env.BLOB_READ_WRITE_TOKEN,
    env.YOUTUBE_API_KEY,
  ];
  return keys.filter((value): value is string => typeof value === "string" && value.length > 0);
}

interface LoggerOptions {
  json: boolean;
  secrets: readonly string[];
  /** Defaults to stderr so stdout stays clean for JSON results. */
  write?: (line: string) => void;
}

export function createLogger(options: LoggerOptions): Logger {
  const write = options.write ?? ((line: string) => process.stderr.write(`${line}\n`));
  const emit = (level: string, message: string, data?: Record<string, unknown>): void => {
    const line = options.json
      ? JSON.stringify({ level, message, ...data })
      : data
        ? `${level}: ${message} ${JSON.stringify(data)}`
        : `${level}: ${message}`;
    write(redact(line, options.secrets));
  };
  return {
    debug: (message, data) => emit("debug", message, data),
    info: (message, data) => emit("info", message, data),
    warn: (message, data) => emit("warn", message, data),
    error: (message, data) => emit("error", message, data),
  };
}
