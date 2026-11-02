/** The day this build was made, which is what changes when the site does ("21 October 2026"). */
export function buildDay(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Stockholm",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
}

/** The same day, short, for the foot of Settings: "2 Nov, 2026". */
export function buildDayShort(): string {
  // en-US: its short months are three letters in every ICU ("Sep"), where en-GB's newer data says "Sept".
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Stockholm",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).formatToParts(new Date());
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("day")} ${get("month")}, ${get("year")}`;
}
