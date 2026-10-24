import type { Item } from "@singularity/core";
import { z } from "zod";
import { buildItems, type RawItem } from "../normalize/buildItem.js";
import type { SourceFetcher } from "./types.js";

export const CROSSREF_API = "https://api.crossref.org";

/** Fields requested from Crossref; everything else in a work record is dead weight here. */
const SELECT = "DOI,title,URL,author,abstract,created,container-title";
const ROWS = 100;

const Person = z.object({
  given: z.string().optional(),
  family: z.string().optional(),
  name: z.string().optional(),
});

const Work = z.object({
  DOI: z.string(),
  URL: z.string().optional(),
  title: z.array(z.string()).optional(),
  author: z.array(Person).optional(),
  /** JATS XML. Often missing, which is fine: the title alone still reaches the judge. */
  abstract: z.string().optional(),
  created: z.object({ "date-time": z.string() }).optional(),
});

const WorksResponse = z.object({ message: z.object({ items: z.array(z.unknown()) }) });

export function crossrefWorksUrl(
  issn: string,
  fromDate: string,
  mailto: string | undefined,
): string {
  const params = new URLSearchParams({
    // from-created-date lists newly deposited records. from-index-date also returns old records
    // that were merely re-indexed, which would flood a weekly pass with back catalogue.
    filter: `from-created-date:${fromDate}`,
    select: SELECT,
    rows: String(ROWS),
    sort: "created",
    order: "desc",
  });
  if (mailto) params.set("mailto", mailto);
  return `${CROSSREF_API}/journals/${issn}/works?${params.toString()}`;
}

function authorNames(people: z.infer<typeof Person>[] | undefined): string | undefined {
  const names = (people ?? [])
    .map((p) => p.name ?? [p.given, p.family].filter(Boolean).join(" "))
    .filter((name) => name !== "");
  if (names.length === 0) return undefined;
  return names.length > 3 ? `${names.slice(0, 3).join(", ")} et al.` : names.join(", ");
}

/** Journal articles through Crossref (ACM TOCHI, PACMHCI). Needs `options.issn`. */
export const fetchCrossref: SourceFetcher = async (source, window, deps): Promise<Item[]> => {
  const issn = source.options.issn;
  if (!issn) throw new Error(`source ${source.id} needs options.issn`);
  const mailto = source.options.mailto ?? deps.crossrefMailto;
  const fromDate = window.from.toISOString().slice(0, 10);
  const body = WorksResponse.safeParse(
    await deps.http.getJson(crossrefWorksUrl(issn, fromDate, mailto), { signal: deps.signal }),
  );
  if (!body.success) throw new Error("unexpected Crossref response shape");

  const raws: RawItem[] = [];
  for (const candidate of body.data.message.items) {
    const work = Work.safeParse(candidate);
    if (!work.success) continue;
    const { DOI, URL: url, title, author, abstract, created } = work.data;
    raws.push({
      url: url ?? `https://doi.org/${DOI}`,
      title: title?.[0],
      author: authorNames(author),
      publishedAt: created?.["date-time"],
      summary: abstract,
    });
  }
  return buildItems(raws, { source, window, fetchedAt: deps.now() });
};
