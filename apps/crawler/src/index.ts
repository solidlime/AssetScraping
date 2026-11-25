/**
 * 1 回だけスクレイプして終了する手動エントリポイント（`pnpm --filter @asset-scraping/crawler start`）。
 * 定期更新は server.ts のプロセス内スケジューラが担う（cron は廃止）。
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
