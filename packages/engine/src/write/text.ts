/** The written fields of one item. Only digests in the older voice, or an agent session, carry a why line. */
export interface WrittenText {
  headline: string;
  chapter?: string | undefined;
  summary: string;
  spoken?: string | undefined;
  why?: string | undefined;
}

/** Copy the text fields, leaving `chapter`, `spoken` and `why` out entirely when there is none. */
export function writtenText(source: WrittenText): {
  headline: string;
  chapter?: string;
  summary: string;
  spoken?: string;
  why?: string;
} {
  return {
    headline: source.headline,
    ...(source.chapter ? { chapter: source.chapter } : {}),
    summary: source.summary,
    ...(source.spoken ? { spoken: source.spoken } : {}),
    ...(source.why ? { why: source.why } : {}),
  };
}
