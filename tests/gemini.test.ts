import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { generateText } from "../src/lib/rag/gemini";
import { _resetKeyRotatorForTests } from "../src/lib/rag/key-rotator";
import { generateForLane } from "../src/lib/rag/providers";
import { _resetProviderRegistryForTests, snapshot } from "../src/lib/rag/providers/registry";
import { ProviderTransient, ProvidersUnavailable } from "../src/lib/rag/providers/types";

/**
 * Deterministic coverage of the Gemini client's failure handling, with fetch
 * stubbed — the same approach as providers.test.ts for the OpenAI-compatible
 * adapter. Every "answer that is not an answer" must come back as
 * ProviderTransient so the router can move on; a raw Error escapes the router
 * and turns /api/ask into a 500.
 */

const GROQ_MODEL = "test/groq-synth";
const ENV_KEYS = [
  "GEMINI_API_KEYS",
  "GROQ_API_KEY",
  "GROQ_SYNTHESIS_MODEL",
  "SYNTHESIS_PROVIDERS",
] as const;

const realFetch = globalThis.fetch;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};
let generateQueue: (() => Response)[] = [];

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status });

const candidate = (text: string, finishReason = "STOP") =>
  jsonResponse({ candidates: [{ content: { parts: [{ text }] }, finishReason }] });

/** A body that starts arriving, then dies — what a timeout mid-read looks like. */
function abortedBody(status = 200): Response {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"candidates":[{"content":'));
      controller.error(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    },
  });
  return new Response(stream, { status });
}

function stubFetch(generate: (() => Response)[]) {
  generateQueue = [...generate];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("generativelanguage.googleapis.com")) {
      if (url.includes(":generateContent")) {
        const next = generateQueue.shift();
        if (!next) throw new Error("stub exhausted");
        return next();
      }
      return jsonResponse({ name: "models/test" }); // preflight metadata GET
    }
    if (url.endsWith("/models")) return jsonResponse({ data: [{ id: GROQ_MODEL }] });
    if (url.endsWith("/chat/completions")) {
      return jsonResponse({
        choices: [{ message: { content: "written by groq" }, finish_reason: "stop" }],
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
}

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.GEMINI_API_KEYS = "key-a,key-b";
  _resetKeyRotatorForTests();
  _resetProviderRegistryForTests();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  _resetKeyRotatorForTests();
  _resetProviderRegistryForTests();
});

describe("Gemini answers that are not answers", () => {
  it("returns a normal answer untouched", async () => {
    stubFetch([() => candidate("**Paging** splits memory into frames.")]);
    await expect(generateText("p")).resolves.toBe("**Paging** splits memory into frames.");
    expect(snapshot("gemini").errors_today).toBe(0);
  });

  it("a body that aborts mid-read is transient, not a raw error", async () => {
    stubFetch([() => abortedBody()]);
    await expect(generateText("p")).rejects.toBeInstanceOf(ProviderTransient);
    expect(snapshot("gemini").last_outcome).toBe("body_read_error");
  });

  it("a malformed JSON body is transient", async () => {
    stubFetch([() => new Response("{ truncated json", { status: 200 })]);
    await expect(generateText("p")).rejects.toBeInstanceOf(ProviderTransient);
  });

  it("an empty candidate is transient", async () => {
    stubFetch([() => candidate("   ")]);
    await expect(generateText("p")).rejects.toBeInstanceOf(ProviderTransient);
    expect(snapshot("gemini").last_outcome).toBe("empty");
  });

  it("a response with no candidates at all is transient", async () => {
    stubFetch([() => jsonResponse({})]);
    await expect(generateText("p")).rejects.toBeInstanceOf(ProviderTransient);
  });

  it("a blocked prompt is transient", async () => {
    stubFetch([() => jsonResponse({ promptFeedback: { blockReason: "SAFETY" } })]);
    await expect(generateText("p")).rejects.toBeInstanceOf(ProviderTransient);
    expect(snapshot("gemini").last_outcome).toBe("blocked_safety");
  });

  it("a safety-cut fragment is never served, even with text in it", async () => {
    stubFetch([() => candidate("**Paging** splits memory into", "SAFETY")]);
    await expect(generateText("p")).rejects.toBeInstanceOf(ProviderTransient);
  });

  it("a truncated answer is refused", async () => {
    stubFetch([() => candidate("**Learn paging first.** Then drill", "MAX_TOKENS")]);
    await expect(generateText("p")).rejects.toBeInstanceOf(ProviderTransient);
    expect(snapshot("gemini").last_outcome).toBe("truncated");
  });

  it("an unreadable ERROR body does not escape either", async () => {
    stubFetch([() => abortedBody(503), () => candidate("recovered")]);
    await expect(generateText("p")).resolves.toBe("recovered");
  });
});

describe("the lane degrades instead of 500ing", () => {
  it("the router hands an empty Gemini answer to the next provider", async () => {
    process.env.SYNTHESIS_PROVIDERS = "gemini,groq";
    process.env.GROQ_API_KEY = "k";
    process.env.GROQ_SYNTHESIS_MODEL = GROQ_MODEL;
    stubFetch([() => candidate("")]);

    const res = await generateForLane("synthesis", "p");
    expect(res.provider).toBe("groq");
    expect(res.text).toBe("written by groq");
  });

  it("with Gemini alone, an unreadable body exhausts the lane — the route's degrade signal", async () => {
    process.env.SYNTHESIS_PROVIDERS = "gemini";
    stubFetch([() => abortedBody()]);

    await expect(generateForLane("synthesis", "p")).rejects.toBeInstanceOf(ProvidersUnavailable);
  });
});
