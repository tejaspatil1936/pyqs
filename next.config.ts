import type { NextConfig } from "next"

const nextConfig: NextConfig = {
    typescript: {
        ignoreBuildErrors: true,
    },
    reactStrictMode: true,
    // onnxruntime (pulled in by @huggingface/transformers) ships native
    // binaries that must not be bundled — used by the RAG assistant's
    // in-process query-time embeddings.
    serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node"],
    logging: {
        fetches: {
            fullUrl: true,
        },
    },
}

export default nextConfig
