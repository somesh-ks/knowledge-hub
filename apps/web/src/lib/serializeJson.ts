const LINE_SEPARATOR = String.fromCodePoint(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCodePoint(0x2029);

/** JSON escape sequence for a character, written as text so the output stays plain ASCII. */
function escapeSequence(char: string): string {
  return `\\u${(char.codePointAt(0) ?? 0).toString(16).padStart(4, "0")}`;
}

/**
 * JSON for a `<script type="application/json">` element. A plain JSON.stringify can end the element
 * early (`</script>`) or open an HTML comment, so the characters that matter to the HTML parser are
 * written as escapes. The result is still valid JSON and parses to the same value.
 */
export function serializeJsonForScript(value: unknown): string {
  let output = JSON.stringify(value);
  for (const char of ["<", ">", "&", LINE_SEPARATOR, PARAGRAPH_SEPARATOR]) {
    output = output.split(char).join(escapeSequence(char));
  }
  return output;
}
