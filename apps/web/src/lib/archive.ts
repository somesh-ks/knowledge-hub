import type { DigestEntry } from "./digests";
import { monthKeyOf, monthName, yearOf } from "./format";

export interface ArchiveMonth {
  key: string;
  label: string;
  entries: DigestEntry[];
}

export interface ArchiveYear {
  year: string;
  months: ArchiveMonth[];
}

/** Year, then month, then day, all newest first. Expects entries already sorted newest first. */
export function groupArchive(entries: readonly DigestEntry[]): ArchiveYear[] {
  const years: ArchiveYear[] = [];
  for (const entry of entries) {
    const year = yearOf(entry.digest.date);
    const key = monthKeyOf(entry.digest.date);
    let yearGroup = years.at(-1);
    if (yearGroup?.year !== year) {
      yearGroup = { year, months: [] };
      years.push(yearGroup);
    }
    let monthGroup = yearGroup.months.at(-1);
    if (monthGroup?.key !== key) {
      monthGroup = { key, label: monthName(key), entries: [] };
      yearGroup.months.push(monthGroup);
    }
    monthGroup.entries.push(entry);
  }
  return years;
}
