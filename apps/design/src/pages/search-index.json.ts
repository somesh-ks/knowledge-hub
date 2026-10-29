import { searchIndex } from "../lib/guide";

export const prerender = true;

/** Components, colours and tokens as one list, which the index page's search reads on first use. */
export function GET() {
  return new Response(JSON.stringify(searchIndex()), {
    headers: { "content-type": "application/json" },
  });
}
