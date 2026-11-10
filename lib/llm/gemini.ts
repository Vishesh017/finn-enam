import { GoogleGenerativeAI } from "@google/generative-ai";

/** Error carrying the HTTP status of the last failed attempt, so callers can map it to a message. */
export class GeminiError extends Error {
  constructor(message: string, public status?: number, public timedOut = false) {
    super(message);
    this.name = "GeminiError";
  }
}

type CallFn = (o: {
  apiKey: string; model: string; system: string; prompt: string; timeoutMs: number;
}) => Promise<string>;

export interface GenerateOptions {
  apiKey: string;
  /** Tried in order. A model that is gone, rate-limited, overloaded or slow is skipped for the next one. */
  models: string[];
  system: string;
  prompt: string;
  /** Total wall-clock budget across every attempt and model. Keep under the route's maxDuration. */
  budgetMs?: number;
  attemptsPerModel?: number;
  call?: CallFn;                         // injectable for tests
  sleep?: (ms: number) => Promise<void>; // injectable for tests
  now?: () => number;                    // injectable for tests
}

const FAST_RETRYABLE = new Set([500, 502, 503, 504]);
const MAX_ATTEMPT_MS = 45_000;
const MIN_ATTEMPT_MS = 8_000;
const SLOW_FAILURE_MS = 8_000; // an error that took this long means the model is struggling

const statusOf = (err: unknown): number | undefined => {
  const s = (err as { status?: unknown })?.status;
  return typeof s === "number" ? s : undefined;
};
const isTimeout = (err: unknown) => /abort|timed? ?out/i.test((err as Error)?.message ?? "");

const defaultCall: CallFn = async ({ apiKey, model, system, prompt, timeoutMs }) => {
  const m = new GoogleGenerativeAI(apiKey).getGenerativeModel(
    {
      model,
      systemInstruction: system,
      generationConfig: { responseMimeType: "application/json", temperature: 0.1, maxOutputTokens: 8192 },
    },
    { timeout: timeoutMs },
  );
  const result = await m.generateContent(prompt);
  return result.response.text(); // throws if the response was blocked
};

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Fails over quickly instead of waiting on a model that is struggling.
 *   quick 500/502/503/504 or network error -> retry the same model after 0.5s, then 1s (3 tries)
 *   timeout, slow 503, 429, 404            -> next model immediately
 *   400/401/403 and blocked responses      -> fail immediately, retrying cannot help
 * Each model gets an equal share of the remaining time, so one slow model cannot use the whole budget.
 */
export async function generateJson(opts: GenerateOptions): Promise<{ text: string; model: string }> {
  const { apiKey, models, system, prompt, budgetMs = 100_000, attemptsPerModel = 3 } = opts;
  const call = opts.call ?? defaultCall;
  const sleep = opts.sleep ?? wait;
  const now = opts.now ?? Date.now;
  const deadline = now() + budgetMs;
  let last: unknown;

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const modelsLeft = models.length - i;

    for (let attempt = 0; attempt < attemptsPerModel; attempt++) {
      const remaining = deadline - now();
      if (remaining < MIN_ATTEMPT_MS) throw toError(last, "Ran out of time budget");

      const share = Math.min(MAX_ATTEMPT_MS, Math.max(MIN_ATTEMPT_MS * 2, remaining / modelsLeft));
      const timeoutMs = Math.min(share, remaining - 1_000);
      const started = now();

      try {
        const text = await call({ apiKey, model, system, prompt, timeoutMs });
        return { text, model };
      } catch (err) {
        last = err;
        const status = statusOf(err);
        const took = now() - started;
        const blocked = /blocked|SAFETY/i.test((err as Error)?.message ?? "");

        if (blocked || (status !== undefined && ![404, 429, ...FAST_RETRYABLE].includes(status))) throw toError(err);
        if (status === 404 || status === 429 || isTimeout(err) || (status === 503 && took > SLOW_FAILURE_MS)) break;
        if (attempt === attemptsPerModel - 1) break;

        const base = 500 * 2 ** attempt;
        const delay = Math.min(base + Math.random() * base * 0.3, Math.max(0, deadline - now() - MIN_ATTEMPT_MS));
        console.warn(`[gemini] ${model} attempt ${attempt + 1} failed (${status ?? "network"}); retrying in ${Math.round(delay)}ms`);
        await sleep(delay);
      }
    }
    console.warn(`[gemini] moving on from ${model}${i === models.length - 1 ? " (last model)" : ""}`);
  }
  throw toError(last, "No Gemini model succeeded");
}

function toError(err: unknown, fallback = "Gemini request failed"): GeminiError {
  if (err instanceof GeminiError) return err;
  return new GeminiError((err as Error)?.message ?? fallback, statusOf(err), isTimeout(err));
}