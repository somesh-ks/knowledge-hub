import { useSyncExternalStore } from "react";
import { getGenerateStore } from "./generateRuntime";
import type { GenerateState } from "./generateStore";

const SERVER_STATE: GenerateState = {
  phase: "idle",
  runId: null,
  step: null,
  failedAt: null,
  digestId: null,
  runUrl: null,
  fieldError: null,
  lostContact: false,
};

function subscribe(onChange: () => void): () => void {
  return getGenerateStore().subscribe(onChange);
}

function getSnapshot(): GenerateState {
  return getGenerateStore().getState();
}

export function useGenerateState(): GenerateState {
  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER_STATE);
}
