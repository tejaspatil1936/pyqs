/**
 * pgvector plumbing — deliberately dependency-free.
 *
 * This lives apart from ./embed so that SQL-only code can format and size a
 * vector without importing the embedding stack. embed.ts pulls in
 * @huggingface/transformers, which loads onnxruntime's native binding at
 * import time; anything that reaches it inherits that cost, and on a
 * serverless runtime missing the native library it inherits a crash. Routes
 * that only run SQL (/api/subjects, /api/stats, /api/topic-questions) must
 * never end up in that module graph — tests/module-graph.test.ts enforces it.
 */

/** all-MiniLM-L6-v2 output width; the `vector(384)` column matches it. */
export const EMBED_DIM = 384;

/** pgvector text literal, e.g. "[0.1,-0.2,...]" — pass as $n::vector. */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.map((x) => x.toFixed(6)).join(",")}]`;
}
