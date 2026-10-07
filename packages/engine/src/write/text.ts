/** The written fields of one item. Only digests in the older voice, or an agent session, carry a why line. */
export interface WrittenText {
  headline: string;
  summary: string;
  why?: string | undefined;
}

/** Copy the text fields, leaving `why` out entirely when there is none. */
export function writtenText(source: WrittenText): {
  headline: string;
  summary: string;
  why?: string;
} {
  return {
    headline: source.headline,
    summary: source.summary,
    ...(source.why ? { why: source.why } : {}),
  };
}
