import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDb, type Database } from "../src/index.js";
import {
  DEFAULT_LOW_BALANCE_THRESHOLD,
  DEFAULT_SCHEDULED_REFRESH_TIME,
  SETTING_KEYS,
  deleteSetting,
  getCrawlerCredential,
  getLowBalanceThreshold,
  getScheduledRefreshTime,
  getSetting,
  normalizeScheduleTime,
  setCrawlerCredential,
  setLowBalanceThreshold,
  setScheduledRefreshTime,
  setSetting,
} from "../src/repositories/settings.js";

let db: Database;

beforeEach(() => {
  db = createDb({ path: ":memory:" });
  migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
});

describe("getSetting / setSetting", () => {
  it("key-value の roundtrip", () => {
    expect(getSetting(db, "foo")).toBeNull();
    setSetting(db, "foo", "bar");
    expect(getSetting(db, "foo")).toBe("bar");
    setSetting(db, "foo", "baz");
    expect(getSetting(db, "foo")).toBe("baz");
  });

  it("deleteSetting で消える", () => {
    setSetting(db, "foo", "bar");
    deleteSetting(db, "foo");
    expect(getSetting(db, "foo")).toBeNull();
  });
});

describe("getLowBalanceThreshold", () => {
  it("未設定は既定値 100000 を返す", () => {
    expect(getLowBalanceThreshold(db)).toBe(DEFAULT_LOW_BALANCE_THRESHOLD);
    expect(DEFAULT_LOW_BALANCE_THRESHOLD).toBe(100_000);
  });

  it("設定した値を返す", () => {
    setLowBalanceThreshold(db, 50_000);
    expect(getLowBalanceThreshold(db)).toBe(50_000);
  });

  it("不正値（非数値・負値）は既定値にフォールバック", () => {
    setSetting(db, SETTING_KEYS.lowBalanceThreshold, "not-a-number");
    expect(getLowBalanceThreshold(db)).toBe(DEFAULT_LOW_BALANCE_THRESHOLD);
    setSetting(db, SETTING_KEYS.lowBalanceThreshold, "-5");
    expect(getLowBalanceThreshold(db)).toBe(DEFAULT_LOW_BALANCE_THRESHOLD);
  });

  it("負値の登録は例外", () => {
    expect(() => setLowBalanceThreshold(db, -1)).toThrow();
  });
});

describe("normalizeScheduleTime", () => {
  it("HH:MM に正規化する", () => {
    expect(normalizeScheduleTime("6:00")).toBe("06:00");
    expect(normalizeScheduleTime("06:05")).toBe("06:05");
    expect(normalizeScheduleTime("23:59")).toBe("23:59");
  });

  it("範囲外・形式不正は null", () => {
    expect(normalizeScheduleTime("24:00")).toBeNull();
    expect(normalizeScheduleTime("06:60")).toBeNull();
    expect(normalizeScheduleTime("0600")).toBeNull();
    expect(normalizeScheduleTime("")).toBeNull();
  });
});

describe("getScheduledRefreshTime", () => {
  it("未設定は既定値 06:00 を返す", () => {
    expect(getScheduledRefreshTime(db)).toBe(DEFAULT_SCHEDULED_REFRESH_TIME);
    expect(DEFAULT_SCHEDULED_REFRESH_TIME).toBe("06:00");
  });

  it("設定した値を正規化して返す", () => {
    setScheduledRefreshTime(db, "15:30");
    expect(getScheduledRefreshTime(db)).toBe("15:30");
  });

  it("不正値は既定値にフォールバック", () => {
    setSetting(db, SETTING_KEYS.scheduledRefreshTime, "25:00");
    expect(getScheduledRefreshTime(db)).toBe(DEFAULT_SCHEDULED_REFRESH_TIME);
  });
});

describe("getCrawlerCredential", () => {
  it("DB に両方揃っていれば DB を優先する", () => {
    setCrawlerCredential(db, "id-db", "pw-db");
    expect(getCrawlerCredential(db, { loginId: "id-env", password: "pw-env" })).toEqual({
      loginId: "id-db",
      password: "pw-db",
    });
  });

  it("DB になければ env にフォールバック", () => {
    expect(getCrawlerCredential(db, { loginId: "id-env", password: "pw-env" })).toEqual({
      loginId: "id-env",
      password: "pw-env",
    });
  });

  it("どちらも無ければ null", () => {
    expect(getCrawlerCredential(db)).toBeNull();
  });

  it("パスワード空文字は既存パスワードを保持する（ID のみ変更）", () => {
    setCrawlerCredential(db, "old-id", "old-pw");
    setCrawlerCredential(db, "new-id", "");
    expect(getCrawlerCredential(db)).toEqual({ loginId: "new-id", password: "old-pw" });
  });

  it("既存パスワードも無い状態で空文字は例外", () => {
    expect(() => setCrawlerCredential(db, "id", "")).toThrow();
  });
});
