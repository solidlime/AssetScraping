import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDb, type Database } from "../src/index.js";
import { saveScrapeFailure, saveScrapeSuccess } from "../src/repositories/settings.js";
import { scrapeWarning } from "../../../apps/mcp/src/tools.ts";

let db: Database;

beforeEach(() => {
  db = createDb({ path: ":memory:" });
  migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
});

describe("scrapeWarning (MCP の結果前置き)", () => {
  it("記録が無ければ警告しない", () => {
    expect(scrapeWarning(db)).toBeNull();
  });

  it("成功直後は警告しない", () => {
    const now = new Date().toISOString();
    saveScrapeSuccess(db, { source: "manual", startedAt: now, finishedAt: now });
    expect(scrapeWarning(db)).toBeNull();
  });

  it("セッション失効の失敗は警告する", () => {
    const ok = new Date().toISOString();
    saveScrapeSuccess(db, { source: "manual", startedAt: ok, finishedAt: ok });
    saveScrapeFailure(db, {
      source: "scheduled",
      startedAt: ok,
      finishedAt: new Date(Date.now() + 1000).toISOString(),
      error: "セッションが失効しています",
      kind: "session_expired",
    });
    const w = scrapeWarning(db);
    expect(w).toContain("SSNB のセッション失効");
    expect(w).toContain("最終成功");
  });

  it("成功していても24時間超なら古いと警告する", () => {
    const old = new Date(Date.now() - 25 * 3600_000).toISOString();
    saveScrapeSuccess(db, { source: "manual", startedAt: old, finishedAt: old });
    expect(scrapeWarning(db)).toContain("データが古い");
  });
});
