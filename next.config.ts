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
    // Turbopack configuration (replaces webpack config)
    turbopack: {
        resolveAlias: {
            "pdfjs-dist/build/pdf.worker.entry": "pdfjs-dist/build/pdf.worker.min.mjs",
        },
    },
    // Keep webpack config for production builds (non-Turbopack)
    webpack: (config, { isServer }) => {
        if (!isServer) {
            config.resolve.alias = {
                ...config.resolve.alias,
                "pdfjs-dist/build/pdf.worker.entry": "pdfjs-dist/build/pdf.worker.min.mjs",
            }
        }
        return config
    },
    // Ensure static files are served correctly
    async headers() {
        return [
            {
                source: "/pdf.worker.min.mjs",
                headers: [
                    {
                        key: "Content-Type",
                        value: "application/javascript",
                    },
                ],
            },
        ]
    },
}

export default nextConfig
