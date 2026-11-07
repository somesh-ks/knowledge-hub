import { describe, expect, it } from "vitest";
import { tokenGroups } from "./catalogue";

describe("the design catalogue's reader", () => {
  it("names each token as the build writes it and keeps a reference as written", () => {
    const groups = tokenGroups("semantic", {
      semantic: {
        color: {
          accent: {
            $type: "color",
            $value: "{primitive.color.blue-700}",
            $description: "The accent.",
          },
        },
        text: {
          title: {
            $type: "typography",
            $value: { size: "{primitive.font.size.title}", weight: 400 },
          },
        },
      },
    });
    expect(groups.get("color")).toEqual([
      {
        path: "color.accent",
        name: "--color-accent",
        type: "color",
        value: "{primitive.color.blue-700}",
        description: "The accent.",
      },
    ]);
    expect(groups.get("text")?.[0]?.value).toBe("size {primitive.font.size.title}, weight 400");
  });
});
