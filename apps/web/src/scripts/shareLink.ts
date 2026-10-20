/**
 * Share a link: the system share sheet where there is one, a copy to the clipboard where there is
 * not. Returns what happened so the caller can say so ("copied" is the one that needs a word).
 */
export async function shareLink(title: string, address: string): Promise<"shared" | "copied" | "none"> {
  const url = new URL(address, location.href).href;
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return "shared";
    } catch (error) {
      // The reader closed the share sheet: nothing more to do. Any other failure falls back to a copy.
      if (error instanceof Error && error.name === "AbortError") return "none";
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    // The clipboard is not available here (an insecure origin, a denied permission).
    return "none";
  }
}
