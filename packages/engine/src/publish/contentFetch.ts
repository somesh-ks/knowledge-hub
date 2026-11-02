/** Reads from the content store's public URLs. 404 is "not there"; any other failure throws. */

export async function fetchText(url: string): Promise<string | null> {
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Store read failed: HTTP ${res.status}`);
  return await res.text();
}

export async function fetchBytes(url: string): Promise<Uint8Array | null> {
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Store read failed: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
