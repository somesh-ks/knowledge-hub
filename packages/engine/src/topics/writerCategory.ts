import { type Category, isBuiltinCategory } from "@dispatch/core";

/**
 * The category label the writer prompt receives. The prompt only knows the built-in categories,
 * so a custom topic's story is labelled with the nearest built-in one the judge found for it.
 * The label steers nothing but the prompt's header; the text comes from the source.
 */
export function writerCategory(category: string, nearest: string | undefined): Category {
  if (isBuiltinCategory(category)) return category;
  return nearest !== undefined && isBuiltinCategory(nearest) ? nearest : "design_engineering_craft";
}
