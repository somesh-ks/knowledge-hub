import { z } from "zod";

const ModelEntry = z
  .object({
    id: z.string(),
    context_length: z.number().optional(),
    max_model_len: z.number().optional(),
    type: z.string().optional(),
  })
  .loose();

/** Shape of Nebius `GET /models?verbose=true`. */
export const ModelsReply = z.object({ data: z.array(ModelEntry) });
export type ModelsReply = z.infer<typeof ModelsReply>;

export interface ModelRow {
  id: string;
  context_length: number | null;
}

/** Embedding, image, speech and rerank models cannot write a digest. */
const NOT_TEXT_ID = /embed|rerank|flux|sdxl|diffusion|whisper|tts|ocr|bge-/i;
const NOT_TEXT_TYPE = /embed|rerank|text2image|image-gen|audio|speech|transcri/i;

export function isTextModel(entry: { id: string; type?: string | undefined }): boolean {
  if (NOT_TEXT_ID.test(entry.id)) return false;
  return entry.type === undefined || !NOT_TEXT_TYPE.test(entry.type);
}

/** Parse a models reply into sorted rows; text models only unless `showAll`. */
export function listModels(body: unknown, showAll: boolean): ModelRow[] {
  const parsed = ModelsReply.parse(body);
  return parsed.data
    .filter((entry) => showAll || isTextModel(entry))
    .map((entry) => ({
      id: entry.id,
      context_length: entry.context_length ?? entry.max_model_len ?? null,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
