/**
 * The one Astro virtual module the player imports. Declared here so the player type-checks on its
 * own; Astro's own declaration for the same module merges with this one.
 */
declare module "astro:transitions/client" {
  export function navigate(
    href: string,
    options?: { history?: "auto" | "push" | "replace"; info?: unknown; sourceElement?: Element },
  ): Promise<void>;
}
