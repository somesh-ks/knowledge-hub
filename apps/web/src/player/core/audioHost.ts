/**
 * Opens the connection to the audio host before Play. The files sit on another origin (the Blob
 * store), and nothing was fetched from it until the first Play, so that Play waited on DNS, TCP and
 * TLS before its first byte: about 0.35 s of 0.85 s on a desktop through a proxy, more on a phone.
 * The connection then stayed open, which is why only the first Play of a session was slow.
 *
 * A preconnect reads no audio (the rule of 2026-10-26: no audio before Play) and works on a cellular
 * link, which the head fetch of D277 skips. In CORS mode, as the player's element asks for the file
 * (getPlayerAudio), so its request can take the socket.
 *
 * shortcut: a browser closes an unused socket after a short while (about 10 s in Chromium, unverified
 * on the owner's phone), so this is called again when the tab comes back; upgrade to a head fetch of
 * the page's own file (D277's gates) if the first Play is still slow.
 */
export function preconnectAudioHost(url: string, doc: Document = document): void {
  let origin: string;
  try {
    origin = new URL(url, doc.baseURI).origin;
  } catch {
    return;
  }
  // A narration:ID source has no host of its own, and the link already there stays.
  if (origin === "null") return;
  // The same origin is already connected (a fixture or a local build).
  if (origin === doc.location.origin) return;
  // A fresh element asks the browser again; the old one would not.
  for (const old of doc.head.querySelectorAll("link[data-audio-host]")) old.remove();
  const link = doc.createElement("link");
  link.rel = "preconnect";
  link.href = origin;
  link.crossOrigin = "anonymous";
  link.dataset.audioHost = "";
  doc.head.append(link);
}
