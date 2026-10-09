/**
 * cron 用エントリポイント（supercronic から 6:30 / 15:30 JST に起動）。
 * 1 回スクレイプして終了する。マイグレーションは事前に db:migrate を実行する前提。
 */
import { createDb, resolveDbPath } from "@asset-scraping/db";
import { runScrape } from "./scrape.js";

async function main(): Promise<void> {
  const dbPath = resolveDbPath();
  const db = createDb({ path: dbPath });
  console.log(`[crawler] db ready: ${dbPath}`);

  const history = process.env.SCRAPE_MODE === "history";
  const stats = await runScrape(db, { history });
  console.log(`[crawler] scrape done: ${JSON.stringify(stats)}`);
}

main().catch((err) => {
  console.error("[crawler] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
