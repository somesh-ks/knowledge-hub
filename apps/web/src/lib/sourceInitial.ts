/**
 * The letter a source's tile shows when the site has no icon, or until its icon loads: the first
 * letter or digit of its name, as a capital. Pure and free of imports, so the Topics page script can
 * bundle it as well as the build.
 */
export function sourceInitial(name: string): string {
  const first = /[\p{L}\p{N}]/u.exec(name.normalize("NFC"));
  return first ? first[0].toLocaleUpperCase("en") : "?";
}
