/**
 * スクレイプ CLI。
 * 使い方: npm run scrape
 * （/cf は当月分しか返さないため SCRAPE_MODE=history は実質通常モードと同一）
 */
import { createDb, resolveDbPath } from "@asset-scraping/db";
import { runScrape } from "./scrape.js";

async function main(): Promise<void> {
  const history = process.env.SCRAPE_MODE === "history";
  const db = createDb({ path: resolveDbPath() });
  console.log(`scrape start (mode=${history ? "history(no-op)" : "recent"}, db=${resolveDbPath()})`);
  const stats = await runScrape(db, { history });
  console.log("scrape done:", JSON.stringify(stats, null, 2));
}

main().catch((err) => {
  console.error("scrape failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
