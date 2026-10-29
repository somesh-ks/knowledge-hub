/**
 * What a design-system component, variant or tone says about itself, so that a person or an agent
 * can pick the right one without reading the stylesheet. Every one says when to use it and, naming
 * the alternative, when not to; designSystem.test.ts holds each to that.
 */
export interface Guidance {
  /** One line: what it is. */
  summary: string;
  /** Situations it is for. */
  useWhen: readonly string[];
  /** Situations that look like it and are not, each naming what to use instead. */
  dontUseWhen: readonly string[];
}
