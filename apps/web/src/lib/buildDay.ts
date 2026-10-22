/** The day this build was made, which is what changes when the site does ("21 October 2026"). */
export function buildDay(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Stockholm",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
}
