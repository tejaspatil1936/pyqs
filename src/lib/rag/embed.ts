/**
 * Query-time embeddings for semantic search.
 *
 * The corpus was embedded by the pipeline with sentence-transformers
 * all-MiniLM-L6-v2 (384-dim, normalized). Cosine similarity is only
 * meaningful inside ONE embedding space, so the query MUST go through the
 * same model — a Gemini embedding would be a different space entirely.
 * sentence-transformers (PyTorch) can't run on Vercel serverless, so we run
 * the same model as quantized ONNX via transformers.js: ~23 MB, downloaded
 * on cold start and cached in /tmp (the only writable path on Vercel).
 *
 * Parity with the Python-side vectors is asserted by an integration test
 * (tests/embed-parity.test.ts).
 */

import {
  pipeline as hfPipeline,
  env,
  type FeatureExtractionPipeline,
} from "@huggingface/transformers";

import { EMBED_DIM } from "./vector";

// transformers.js' overloaded pipeline() signature explodes into a union too
// complex for tsc (TS2590); collapse it to the one call shape we use.
const pipeline = hfPipeline as (
  task: "feature-extraction",
  model: string,
  options?: { dtype: string },
) => Promise<FeatureExtractionPipeline>;

env.cacheDir = process.env.TRANSFORMERS_CACHE_DIR ?? "/tmp/transformers-cache";

// Same weights as sentence-transformers/all-MiniLM-L6-v2, converted to ONNX.
const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

/**
 * One in-flight load is shared by every concurrent caller, and a successful
 * load is kept for the life of the instance. A FAILED load is not: memoizing
 * the rejection would turn one bad cold start (a network blip mid-download, a
 * half-written cache file) into a 500 on every semantic query until the
 * instance is recycled. transformers.js deletes a partial download when it
 * errors, so the next call re-fetches cleanly.
 */
function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    const attempt = pipeline("feature-extraction", MODEL_ID, { dtype: "q8" });
    extractorPromise = attempt;
    attempt.catch(() => {
      if (extractorPromise === attempt) extractorPromise = null;
    });
  }
  return extractorPromise;
}

export async function embedQuery(text: string): Promise<number[]> {
  const extractor = await getExtractor();
  // mean pooling + L2 normalize matches the pipeline's
  // encode(..., normalize_embeddings=True)
  const out = await extractor(text, { pooling: "mean", normalize: true });
  const vec = Array.from(out.data as Float32Array);
  if (vec.length !== EMBED_DIM) {
    throw new Error(`expected ${EMBED_DIM}-dim embedding, got ${vec.length}`);
  }
  return vec;
}
