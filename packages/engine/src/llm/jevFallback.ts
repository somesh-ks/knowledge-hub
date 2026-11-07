import type { ModelStep } from "@singularity/core";
import { z } from "zod";
import type { Logger } from "../context.js";
import type { JevClientLike } from "../judge/jev.js";
import { BudgetExceededError, DeadlineExceededError } from "./errors.js";
import { failureReason, type ModelRouter } from "./modelRouter.js";
import { boundaryLine, newBoundary, untrustedInstruction, wrapUntrusted } from "./untrusted.js";

interface QuestionLike {
  type?: string;
  instructions?: string;
  criteria?: Record<string, string>;
}

/**
 * Jev first, then the step's next models. A Jev request that fails for any reason is answered by
 * the routing chain (Claude Haiku or Gemini) when every question is a noul (a probability the
 * claim holds) or a choice, which is all the single-question steps (grounding, taste fit, source
 * format, topic emoji) ask. The answer has Jev's shape, so callers parse it unchanged. The switch
 * is a warning in the run log, never silent. A question of another kind rethrows Jev's error.
 */
export function withModelFallback(
  jev: JevClientLike,
  router: ModelRouter,
  step: ModelStep,
  log: Logger,
): JevClientLike {
  return {
    async systemOne(request) {
      try {
        return await jev.systemOne(request);
      } catch (error) {
        if (error instanceof BudgetExceededError || error instanceof DeadlineExceededError) {
          throw error;
        }
        return answerWithRoutedModels(
          router,
          step,
          request,
          () => error,
          () => {
            log.warn("Jev failed; the routing chain answers this request instead", {
              step,
              ...failureReason(error),
            });
          },
        );
      }
    },
  };
}

/**
 * A Jev-shaped client that never calls Jev: the step's routing chain answers every request. Used
 * when no Jev key is set, so grounding still checks each claim and the digest is not left unverified.
 * A question that is neither a noul nor a choice needs Jev, so its request throws.
 */
export function routedJev(router: ModelRouter, step: ModelStep): JevClientLike {
  return {
    systemOne(request) {
      return answerWithRoutedModels(router, step, request, (type) => {
        return new Error(
          `The ${step} step needs Jev for a ${type ?? "unknown"} question; the routed models answer only noul and choice questions.`,
        );
      });
    },
  };
}

/**
 * Asks the routing chain each question of a Jev request and returns the answers in Jev's shape.
 * `unsupported` gives the value to throw for a question that is neither a noul nor a choice, and
 * `warn` runs once the request is known to be answerable.
 */
async function answerWithRoutedModels(
  router: ModelRouter,
  step: ModelStep,
  request: Parameters<JevClientLike["systemOne"]>[0],
  unsupported: (type: string | undefined) => unknown,
  warn?: () => void,
): Promise<{ answers: Record<string, unknown> }> {
  const questions = request.questions as Record<string, QuestionLike>;
  const shape: Record<string, z.ZodType> = {};
  for (const [name, question] of Object.entries(questions)) {
    const keys = Object.keys(question.criteria ?? {});
    if (question.type === "noul") shape[name] = z.object({ noul: z.number().min(0).max(1) });
    else if (question.type === "choice" && keys.length > 0) {
      shape[name] = z.object({ choice: z.enum(keys as [string, ...string[]]) });
    } else throw unsupported(question.type);
  }
  warn?.();
  const boundary = newBoundary();
  const asked = Object.entries(questions).map(([name, q]) => ({
    name,
    type: q.type,
    question: q.instructions,
    options: q.criteria,
  }));
  const schema = z.object(shape);
  const result = await router.callModel(step, {
    schema,
    schemaName: "answers",
    label: `${step} fallback`,
    maxTokens: 400,
    messages: [
      {
        role: "system",
        content: `Answer each question about the data. For a noul question give the probability from 0 to 1 that the statement is true; for a choice question give exactly one option key. ${untrustedInstruction()}`,
      },
      {
        role: "user",
        content: `${boundaryLine(boundary)}\n\nQuestions: ${JSON.stringify(asked)}\n\n${wrapUntrusted(JSON.stringify(request.state), boundary, "state")}`,
      },
    ],
  });
  const answers: Record<string, unknown> = {};
  const value = result.value as Record<string, Record<string, unknown>>;
  for (const [name, question] of Object.entries(questions)) {
    answers[name] = { type: question.type, ...value[name] };
  }
  return { answers };
}
