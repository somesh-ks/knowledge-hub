/**
 * Markup for reading: a spec's HTML string broken onto indented lines, with each icon folded to one
 * line so the glyph's path does not bury the element around it. Display only; never parsed back.
 */
const VOID = new Set(["input", "img", "br", "hr", "path", "meta", "link"]);
const INLINE_LIMIT = 48;

export function prettyMarkup(html: string): string {
  const folded = html.replace(
    /<svg([^>]*?)data-icon="([^"]+)"([^>]*)>[\s\S]*?<\/svg>/g,
    (_match, _before, name) => `<svg class="icon" data-icon="${name}">…</svg>`,
  );
  const tokens = folded.split(/(<[^>]+>)/).filter((token) => token.trim() !== "");
  const lines: string[] = [];
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = (tokens[i] ?? "").trim();
    const next = (tokens[i + 1] ?? "").trim();
    const afterNext = (tokens[i + 2] ?? "").trim();
    const isTag = token.startsWith("<");
    const isClose = token.startsWith("</");
    const name = isTag ? (token.match(/^<\/?([a-zA-Z0-9-]+)/)?.[1] ?? "") : "";
    // <tag>short text</tag> stays on one line.
    if (
      isTag &&
      !isClose &&
      !VOID.has(name) &&
      !token.endsWith("/>") &&
      next &&
      !next.startsWith("<") &&
      next.length <= INLINE_LIMIT &&
      afterNext === `</${name}>`
    ) {
      lines.push(`${"  ".repeat(depth)}${token}${next}${afterNext}`);
      i += 2;
      continue;
    }
    if (isClose) depth = Math.max(0, depth - 1);
    lines.push(`${"  ".repeat(depth)}${token}`);
    if (isTag && !isClose && !VOID.has(name) && !token.endsWith("/>") && !token.startsWith("<!"))
      depth++;
  }
  return lines.join("\n");
}
