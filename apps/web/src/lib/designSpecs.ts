/**
 * Every component spec in apps/web (D220), loaded from the `*.design.ts` files beside the
 * components and the stylesheets. The style guide and the coverage test read this one list.
 */
import { type DesignSpec, sortSpecs } from "./designSpec";

const modules = import.meta.glob<{ default: DesignSpec }>("../**/*.design.ts", { eager: true });

export const designSpecs: readonly DesignSpec[] = sortSpecs(
  Object.values(modules).map((module) => module.default),
);

export const designSpecById = (id: string): DesignSpec | undefined =>
  designSpecs.find((spec) => spec.id === id);
