/**
 * スクレイプ CLI。
 * 使い方: npm run scrape            （通常: 直近2ヶ月）
 *         SCRAPE_MODE=history npm run scrape   （24ヶ月遡行）
 */
import { createDb, resolveDbPath } from "@asset-scraping/db";
import { runScrape } from "./scrape.js";

async function main(): Promise<void> {
  const history = process.env.SCRAPE_MODE === "history";
  const db = createDb({ path: resolveDbPath() });
  console.log(`scrape start (mode=${history ? "history" : "recent"}, db=${resolveDbPath()})`);
  const stats = await runScrape(db, { history });
  console.log("scrape done:", JSON.stringify(stats, null, 2));
}

main().catch((err) => {
  console.error("scrape failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
