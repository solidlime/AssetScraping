import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // better-sqlite3 はネイティブ addon のため bundle せず node_modules から実行時 require
  // （bundle すると __dirname が .next/server に化けて bindings が見つからない）
  serverExternalPackages: ["@asset-scraping/db", "better-sqlite3", "drizzle-orm"],
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
    // better-sqlite3（ネイティブ addon）は bundle せず node_modules から実行時 require。
    // bundle すると __dirname が .next/server に化けて bindings が見つからない。
    config.externals = [
      ...(Array.isArray(config.externals) ? config.externals : []),
      { "better-sqlite3": "commonjs better-sqlite3" },
    ];
    return config;
  },
};

export default nextConfig;
