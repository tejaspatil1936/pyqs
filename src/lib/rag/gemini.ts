/**
 * Runtime Gemini client for /api/ask.
 *
 * Every call round-robins across ALL keys in GEMINI_API_KEYS via the
 * KeyRotator (random start per instance, advance per request, cooldown on
 * per-minute 429s, benched-for-the-UTC-day on daily-quota 429s). Callers
 * degrade only when every key is benched.
 *
 * Gemini 3.x are thinking models; chat answers need speed, not reasoning,
 * so requests ask for minimal thinking and silently drop the config if the
 * configured model rejects it (mirrors the pipeline's fallback ladder).
 */

import { AllKeysBenched, acquireKey, benchKey, benchKeyForDay } from "./key-rotator";
import { recordCall } from "./providers/registry";
import { ProviderModelDead, ProvidersUnavailable } from "./providers/types";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite";

/**
 * Gemini is rate-limited or down — callers degrade. Now an alias of the
 * lane-wide ProvidersUnavailable so existing `instanceof` checks keep
 * working after the multi-provider split (a lane that exhausts EVERY
 * provider is exactly the condition this used to mean).
 */
export { ProvidersUnavailable as GeminiUnavailable } from "./providers/types";

// Sticky per-instance: once the model rejects thinkingConfig we stop sending it.
let sendThinkingConfig = true;

interface GenerateOptions {
  json?: boolean;
  timeoutMs?: number;
}

/** Pipeline-style 429 anatomy: daily-quota vs per-minute, with retryDelay. */
function parse429(body: string): { daily: boolean; retryMs: number } {
  const daily = /perday/i.test(body);
  const m =
    /retry_?[dD]elay\\?"?\s*:\s*\\?"?(\d+)/.exec(body) ?? /"retryDelay"\s*:\s*"(\d+)/.exec(body);
  const retryMs = m ? (Number(m[1]) + 1) * 1000 : 30_000;
  return { daily, retryMs };
}

// Key indexes only — never values (same contract as the pipeline).
// Also feeds the per-provider daily counters behind /api/health.
function logKey(index: number, outcome: string): void {
  console.log(JSON.stringify({ evt: "gemini_call", key_index: index, outcome }));
  recordCall("gemini", outcome);
}

/**
 * Model reachability check for the provider preflight: a metadata GET, so it
 * costs no generation quota. A 404 means the configured GEMINI_MODEL is
 * retired or misspelled — a deploy bug, surfaced as ProviderModelDead.
 */
export async function geminiPreflight(): Promise<void> {
  let key: string;
  try {
    ({ key } = acquireKey());
  } catch (err) {
    if (err instanceof AllKeysBenched) {
      throw new ProvidersUnavailable("all Gemini keys are rate-limited or out of quota");
    }
    throw new ProviderModelDead("gemini", GEMINI_MODEL, "GEMINI_API_KEYS is not set");
  }
  const resp = await fetch(`${API_BASE}/${GEMINI_MODEL}?key=${key}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (resp.status === 404) {
    throw new ProviderModelDead("gemini", GEMINI_MODEL, "model not found (HTTP 404)");
  }
  if (resp.status === 400 || resp.status === 401 || resp.status === 403) {
    throw new ProviderModelDead(
      "gemini",
      GEMINI_MODEL,
      `key rejected (HTTP ${resp.status}) — check GEMINI_API_KEYS`,
    );
  }
  // Anything else (5xx, network) is transient; the caller retries the check.
  if (!resp.ok) throw new Error(`Gemini preflight HTTP ${resp.status}`);
}

export async function generateText(
  prompt: string,
  { json = false, timeoutMs = 30_000 }: GenerateOptions = {},
): Promise<string> {
  let retriedServerError = false;
  // Enough attempts to visit every key twice even in a large pool.
  const maxAttempts = 8;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let index: number;
    let key: string;
    try {
      ({ key, index } = acquireKey());
    } catch (err) {
      if (err instanceof AllKeysBenched) {
        throw new ProvidersUnavailable("all Gemini keys are rate-limited or out of quota");
      }
      throw err;
    }

    const generationConfig: Record<string, unknown> = { temperature: 0 };
    if (json) generationConfig.responseMimeType = "application/json";
    if (sendThinkingConfig) generationConfig.thinkingConfig = { thinkingLevel: "minimal" };

    let resp: Response;
    try {
      resp = await fetch(`${API_BASE}/${GEMINI_MODEL}:generateContent?key=${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      // Timeouts and network failures degrade like quota exhaustion —
      // callers fall back to retrieval/analytics instead of a 500. Not a
      // key problem, so no bench.
      logKey(index, "network_error");
      throw new ProvidersUnavailable(
        `Gemini unreachable (${err instanceof Error ? err.name : "network error"}) — try again shortly`,
      );
    }

    if (resp.ok) {
      const body = (await resp.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = (body.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? "")
        .join("");
      if (!text) throw new Error("Gemini returned an empty candidate");
      logKey(index, "ok");
      return text;
    }

    const errText = await resp.text();

    if (resp.status === 400 && sendThinkingConfig && errText.toLowerCase().includes("thinking")) {
      sendThinkingConfig = false; // model doesn't take thinkingConfig; drop it for this instance
      continue;
    }
    if (resp.status === 429) {
      const { daily, retryMs } = parse429(errText);
      if (daily) {
        logKey(index, "quota_benched_for_day");
        benchKeyForDay(index);
      } else {
        logKey(index, `rate_limited_${Math.round(retryMs / 1000)}s`);
        benchKey(index, retryMs);
      }
      continue; // next key
    }
    if (resp.status === 401 || resp.status === 403) {
      logKey(index, `rejected_${resp.status}`);
      benchKeyForDay(index); // bad key — out for the day
      continue;
    }
    if (resp.status >= 500 && !retriedServerError) {
      retriedServerError = true;
      logKey(index, `server_${resp.status}`);
      continue;
    }
    logKey(index, `error_${resp.status}`);
    throw new Error(`Gemini HTTP ${resp.status}: ${errText.slice(0, 300)}`);
  }

  throw new ProvidersUnavailable("Gemini request did not succeed after rotating keys");
}
