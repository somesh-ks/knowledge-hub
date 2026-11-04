import { describe, expect, it } from "vitest";
import { withFrameAncestors } from "./frameAncestors";

// The live home page sent a policy with no frame-ancestors once Astro's header replaced vercel.json's.
describe("withFrameAncestors", () => {
  const policyOf = (response: Response) => response.headers.get("content-security-policy");

  it("adds the directive to a policy that lacks it, keeping the rest and the body", async () => {
    const out = withFrameAncestors(
      new Response("page", { headers: { "content-security-policy": "default-src 'self';" } }),
    );
    expect(policyOf(out)).toBe("default-src 'self'; frame-ancestors 'none'");
    expect(await out.text()).toBe("page");
  });

  it("leaves a policy that has it, and a response with no policy, as they are", () => {
    const has = new Response("", {
      headers: { "content-security-policy": "frame-ancestors 'none'; default-src 'self'" },
    });
    expect(withFrameAncestors(has)).toBe(has);
    const none = new Response("");
    expect(withFrameAncestors(none)).toBe(none);
  });
});
