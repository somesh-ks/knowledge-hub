/**
 * What a download that failed says (D331). A full disk is not a connection problem: telling that
 * reader to wait for the network sends them to wait for nothing, so it is told apart.
 */
const NO_SPACE =
  "There's not enough space on this device to keep it. Free some space and try again.";
const RETRY = "Couldn't download. Try again.";

export function downloadFailure(error: unknown): string {
  const name = (error as { name?: unknown } | null)?.name;
  return name === "QuotaExceededError" ? NO_SPACE : RETRY;
}
