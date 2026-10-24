import { type DigestId, DigestId as DigestIdSchema, type DigestKind } from "@singularity/core";

/**
 * Next free id for a digest on `date`. The weekly pass prefers `<date>-weekly`; every other
 * case starts at `<date>` and then takes `-2`, `-3` and so on. An id already in use is never
 * returned, including when the weekly slot is taken (core ids have no `-weekly-2`, so a second
 * weekly the same day takes the next numeric suffix).
 */
export function allocateDigestId(
  date: string,
  kind: DigestKind,
  existingIds: Iterable<string>,
): DigestId {
  const taken = new Set(existingIds);
  if (kind === "weekly" && !taken.has(`${date}-weekly`))
    return DigestIdSchema.parse(`${date}-weekly`);
  if (kind !== "weekly" && !taken.has(date)) return DigestIdSchema.parse(date);
  for (let n = 2; ; n++) {
    const candidate = `${date}-${n}`;
    if (!taken.has(candidate)) return DigestIdSchema.parse(candidate);
  }
}
