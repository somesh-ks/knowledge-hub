const ZONE_OFFSETS: Record<string, string> = {
  UT: "+0000",
  UTC: "+0000",
  GMT: "+0000",
  Z: "+0000",
  EST: "-0500",
  EDT: "-0400",
  CST: "-0600",
  CDT: "-0500",
  MST: "-0700",
  MDT: "-0600",
  PST: "-0800",
  PDT: "-0700",
  CET: "+0100",
  CEST: "+0200",
  BST: "+0100",
  IST: "+0530",
};

const HAS_OFFSET = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;

/**
 * Parse the date formats feeds actually contain: ISO 8601 and RFC 822. A date-time without an
 * offset is read as UTC, because the JavaScript default (local time) would make results depend
 * on the machine running the engine.
 */
export function parseFeedDate(value: string | undefined | null): Date | undefined {
  if (value === undefined || value === null) return undefined;
  const text = value.trim();
  if (text === "") return undefined;

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) {
    const iso = HAS_OFFSET.test(text) ? text : `${text}Z`;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const date = new Date(`${text}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  const zoneMatch = /\s([A-Za-z]{1,4})$/.exec(text);
  const zone = zoneMatch?.[1];
  const offset = zone === undefined ? undefined : ZONE_OFFSETS[zone.toUpperCase()];
  const normalized = zoneMatch && offset ? `${text.slice(0, zoneMatch.index)} ${offset}` : text;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
