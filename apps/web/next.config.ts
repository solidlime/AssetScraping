import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // pnpm workspace の TS ソース (packages/db) を直接参照するため、
  // workspace ルート外のシンボリックリンク先をトレースさせる
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  experimental: {
    externalDir: true,
  },
  webpack: (config) => {
    // workspace パッケージは TS ソースのまま参照されるため、
    // NodeNext の .js 拡張子付き import を .ts に解決させる
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
    };
    return config;
  },
};

export default nextConfig;
