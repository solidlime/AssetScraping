/**
 * 定期更新スケジューラ。
 * docker crontab は動的変更できないため、サーバ内 setInterval で時刻到達判定し、
 * 設定時刻 (app_settings.scheduled_refresh_time, JST "HH:MM") は毎 tick DB から再読込する。
 */
export interface HhMm {
  h: number;
  m: number;
}

/** "HH:MM" を分解。不正値は null（settings 側で正規化済みだが二重防御） */
export function parseHhMm(raw: string): HhMm | null {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(raw);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return { h, m: mm };
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** JST は UTC+9 固定（ホストのタイムゾーン設定に依存しない計算） */
const JST_OFFSET_MS = 9 * HOUR_MS;

/** 与えた時刻から見た「JST でのその日の 00:00」の epoch ms */
export function jstDayStartMs(now: Date): number {
  const jstMs = now.getTime() + JST_OFFSET_MS;
  return Math.floor(jstMs / DAY_MS) * DAY_MS - JST_OFFSET_MS;
}

/**
 * 次に HH:MM (JST) が訪れる epoch ms。
 * 現在時刻ちょうどは「到達済み」（翌日扱い）とする。
 */
export function nextOccurrenceJst(now: Date, hhmm: string): number {
  const parsed = parseHhMm(hhmm);
  if (!parsed) throw new Error(`時刻は HH:MM 形式で指定してください: ${hhmm}`);
  const dayStart = jstDayStartMs(now);
  const target = dayStart + parsed.h * HOUR_MS + parsed.m * MINUTE_MS;
  if (target > now.getTime()) return target;
  return target + DAY_MS;
}
