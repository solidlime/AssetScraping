import { describe, expect, it } from "vitest";
import { jstDayStartMs, nextOccurrenceJst, parseHhMm } from "../src/scheduler.js";

describe("parseHhMm", () => {
  it("HH:MM を分解する", () => {
    expect(parseHhMm("06:00")).toEqual({ h: 6, m: 0 });
    expect(parseHhMm("23:59")).toEqual({ h: 23, m: 59 });
  });
  it("不正値は null", () => {
    expect(parseHhMm("24:00")).toBeNull();
    expect(parseHhMm("6:60")).toBeNull();
    expect(parseHhMm("abc")).toBeNull();
  });
});

describe("jstDayStartMs", () => {
  it("JST 00:00 の epoch ms を返す（UTC では前日 15:00）", () => {
    // 2026-02-14T00:00:00+09:00 == 2026-02-13T15:00:00Z
    const now = new Date("2026-02-14T02:30:00+09:00");
    expect(new Date(jstDayStartMs(now)).toISOString()).toBe("2026-02-13T15:00:00.000Z");
  });
});

describe("nextOccurrenceJst", () => {
  it("同日の設定時刻がまだ来ていれば同日の時刻を返す", () => {
    // 2026-02-14 02:30 JST → 同日 06:00 JST
    const now = new Date("2026-02-14T02:30:00+09:00");
    const next = nextOccurrenceJst(now, "06:00");
    expect(new Date(next).toISOString()).toBe("2026-02-13T21:00:00.000Z");
  });

  it("同日の設定時刻を過ぎていれば翌日の時刻を返す", () => {
    const now = new Date("2026-02-14T07:00:00+09:00");
    const next = nextOccurrenceJst(now, "06:00");
    expect(new Date(next).toISOString()).toBe("2026-02-14T21:00:00.000Z");
  });

  it("現在時刻ちょうどの場合は翌日（到達済み扱い）", () => {
    const now = new Date("2026-02-14T06:00:00+09:00");
    const next = nextOccurrenceJst(now, "06:00");
    expect(new Date(next).toISOString()).toBe("2026-02-14T21:00:00.000Z");
  });
});
