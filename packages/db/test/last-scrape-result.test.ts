import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDb, type Database } from "../src/index.js";
import {
  describeScrapeState,
  SETTING_KEYS,
  getLastScrapeResult,
  saveScrapeFailure,
  saveScrapeSuccess,
  setSetting,
} from "../src/repositories/settings.js";

let db: Database;

beforeEach(() => {
  db = createDb({ path: ":memory:" });
  migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
});

describe("getLastScrapeResult", () => {
  it("未記録は null", () => {
    expect(getLastScrapeResult(db)).toBeNull();
  });

  it("壊れた JSON は null", () => {
    setSetting(db, SETTING_KEYS.lastScrapeResult, "{broken");
    expect(getLastScrapeResult(db)).toBeNull();
  });
});

describe("saveScrapeSuccess / saveScrapeFailure", () => {
  it("成功は ok=true で lastSuccessAt を finishedAt にする", () => {
    saveScrapeSuccess(db, {
      source: "manual",
      startedAt: "2026-05-01T00:00:00.000Z",
      finishedAt: "2026-05-01T00:05:00.000Z",
    });
    expect(getLastScrapeResult(db)).toEqual({
      ok: true,
      source: "manual",
      startedAt: "2026-05-01T00:00:00.000Z",
      finishedAt: "2026-05-01T00:05:00.000Z",
      lastSuccessAt: "2026-05-01T00:05:00.000Z",
    });
  });

  it("失敗は kind を記録し lastSuccessAt を引き継ぐ", () => {
    saveScrapeSuccess(db, {
      source: "manual",
      startedAt: "2026-05-01T00:00:00.000Z",
      finishedAt: "2026-05-01T00:05:00.000Z",
    });
    saveScrapeFailure(db, {
      source: "scheduled",
      startedAt: "2026-05-02T00:00:00.000Z",
      finishedAt: "2026-05-02T00:01:00.000Z",
      error: "セッションが失効しています",
      kind: "session_expired",
    });
    expect(getLastScrapeResult(db)).toEqual({
      ok: false,
      source: "scheduled",
      startedAt: "2026-05-02T00:00:00.000Z",
      finishedAt: "2026-05-02T00:01:00.000Z",
      error: "セッションが失効しています",
      kind: "session_expired",
      lastSuccessAt: "2026-05-01T00:05:00.000Z",
    });
  });

  it("成功実績が無い失敗は lastSuccessAt を持たない", () => {
    saveScrapeFailure(db, {
      source: "manual",
      startedAt: "2026-05-01T00:00:00.000Z",
      finishedAt: "2026-05-01T00:00:01.000Z",
      error: "boom",
      kind: "other",
    });
    const result = getLastScrapeResult(db);
    expect(result?.ok).toBe(false);
    expect(result?.lastSuccessAt).toBeUndefined();
  });

  it("成功すると前回の失敗理由が消える", () => {
    saveScrapeFailure(db, {
      source: "manual",
      startedAt: "2026-05-01T00:00:00.000Z",
      finishedAt: "2026-05-01T00:00:01.000Z",
      error: "boom",
      kind: "other",
    });
    saveScrapeSuccess(db, {
      source: "manual",
      startedAt: "2026-05-02T00:00:00.000Z",
      finishedAt: "2026-05-02T00:00:10.000Z",
    });
    const result = getLastScrapeResult(db);
    expect(result?.ok).toBe(true);
    expect(result?.error).toBeUndefined();
    expect(result?.kind).toBeUndefined();
  });
});

describe("describeScrapeState", () => {
  const lastSuccessAt = "2026-05-02T00:00:10.000Z";
  const success = {
    ok: true,
    source: "manual",
    startedAt: "2026-05-02T00:00:00.000Z",
    finishedAt: lastSuccessAt,
    lastSuccessAt,
  };
  const failure = {
    ...success,
    ok: false,
    error: "セッション切れ",
    kind: "session_expired" as const,
  };
  const base = Date.parse(lastSuccessAt);

  it("未記録は null", () => {
    expect(describeScrapeState(null, base)).toBeNull();
  });

  it("成功直後は警告不要", () => {
    const state = describeScrapeState(success, base + 60_000);
    expect(state).toMatchObject({ failedKind: null, stale: false, hoursSinceSuccess: 0 });
  });

  it("成功でも24時間超なら stale", () => {
    const state = describeScrapeState(success, base + 25 * 3_600_000);
    expect(state?.failedKind).toBeNull();
    expect(state?.stale).toBe(true);
    expect(state?.hoursSinceSuccess).toBe(25);
  });

  it("失敗は kind を返す（成功時刻は引き継がれる）", () => {
    const state = describeScrapeState(failure, base + 60_000);
    expect(state).toMatchObject({ failedKind: "session_expired", stale: false });
  });

  it("kind 無しの失敗は other に丸める", () => {
    const state = describeScrapeState({ ...failure, kind: undefined }, base);
    expect(state?.failedKind).toBe("other");
  });
});
