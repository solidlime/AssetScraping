/**
 * マイグレーション実行スクリプト。
 * 使い方: DB_PATH=/data/asset-scraping.db npm run db:migrate
 */
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDb, resolveDbPath } from "../client.js";

const db = createDb({ path: resolveDbPath() });
migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1") });
console.log("migrations applied:", resolveDbPath());
