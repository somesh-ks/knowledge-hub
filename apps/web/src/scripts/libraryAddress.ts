/** The Library as it was left, with its search, filter and order, or the plain Library. */
export function libraryAddress(): string {
  try {
    const kept = sessionStorage.getItem("singularity:library-url");
    if (kept?.startsWith("/library")) return kept;
  } catch {
    // Storage can be blocked.
  }
  return "/library";
}
