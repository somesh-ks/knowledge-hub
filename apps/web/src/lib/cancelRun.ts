/**
 * Stops a generation: POST /api/cancel with its run id. "cancelled" when GitHub took it (the run
 * stops within moments, and the run indicator's next poll says so), "finished" when it had already
 * ended, "failed" for anything else (offline, a refusal, a server fault), so the caller can say it
 * did not work and offer to try again. Never throws.
 */
export type CancelResult = "cancelled" | "finished" | "failed";

export async function cancelRun(
  id: number,
  send: typeof fetch = (input, init) => fetch(input, init),
): Promise<CancelResult> {
  try {
    const response = await send("/api/cancel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ run_id: id }),
    });
    if (response.status === 202) return "cancelled";
    if (response.status === 409) return "finished";
    return "failed";
  } catch {
    return "failed";
  }
}
