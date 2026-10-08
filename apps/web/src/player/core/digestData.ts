import type { PlayerDigestData } from "../../types/contracts";
import { isFiniteNumber } from "./mathUtils";

export const DIGEST_DATA_ELEMENT_ID = "dispatch-digest-data";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableMs(value: unknown): boolean {
  return value === null || isFiniteNumber(value);
}

/**
 * Checks only what the player dereferences. The page author owns the JSON, and a typo there must
 * degrade to "no player for this page", never to an exception inside a navigation handler.
 */
export function isPlayerDigestData(value: unknown): value is PlayerDigestData {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || typeof value.title !== "string") return false;
  if (typeof value.date !== "string") return false;
  if (!Array.isArray(value.items) || !Array.isArray(value.sections)) return false;
  const audio = value.audio;
  if (audio !== null) {
    if (!isRecord(audio) || typeof audio.url !== "string" || !isFiniteNumber(audio.duration_ms)) {
      return false;
    }
  }
  const cover = value.cover;
  if (!isRecord(cover) || typeof cover.src512 !== "string" || typeof cover.src1024 !== "string") {
    return false;
  }
  if (typeof cover.key !== "string") return false;
  return value.items.every(
    (item) =>
      isRecord(item) &&
      typeof item.id === "string" &&
      typeof item.headline === "string" &&
      typeof item.section === "string" &&
      typeof item.source === "string" &&
      (item.url === undefined || item.url === null || typeof item.url === "string") &&
      isNullableMs(item.start_ms) &&
      isNullableMs(item.end_ms),
  );
}

/** Parses the JSON script element. Returns null when the page has none or it is malformed. */
export function readDigestData(
  doc: Pick<Document, "getElementById"> = document,
): PlayerDigestData | null {
  const element = doc.getElementById(DIGEST_DATA_ELEMENT_ID);
  const text = element?.textContent;
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return isPlayerDigestData(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
