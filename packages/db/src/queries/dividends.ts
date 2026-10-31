import { and, eq, max } from "drizzle-orm";
import {
  addDaysToIsoDateKey,
  getJstDateParts,
  getJstTodayIsoDate,
  getJstYearMonthKey,
  shiftYearMonthKey,
} from "@asset-scraping/date-utils";
import { toYahooSymbol } from "@asset-scraping/shared";
import { schema, type Db } from "../index.ts";

// ============================================================================
// 配当・分配シミュレータ 推定ロジック（F6）
// ============================================================================
// データ源:
//   - holdings / holding_values / asset_categories … 保有銘柄（評価額・数量）
//   - dividend_symbols … 保有名 → Yahoo シンボル / 年間分配金（投信・ラップ）の解決表
//   - dividend_events … Yahoo から取得した 1 株あたり配当イベント（ex-date 基準）
//   - fx_rates … 外貨建て配当の円換算レート（USDJPY）
// ============================================================================

/** シミュレーション対象の資産カテゴリ。これ以外は合計に入れない。 */
const TARGET_CATEGORIES = new Set(["株式(現物)", "投資信託", "年金"]);

const REASON_OUT_OF_SCOPE = "対象外カテゴリ";
const REASON_NO_DISTRIBUTION = "分配なし設定";
const REASON_UNRESOLVED_SYMBOL = "シンボル未解決";
const REASON_UNRESOLVED_FX = "為替レート未取得";

export type DividendForecastRow = {
  holdingName: string; // 表示用の基底名（重複サフィックス除去後）
  rawHoldingName: string; // holdings.name そのまま
  category: string | null; // asset_categories.name
  code: string | null; // holdings.code
  quantity: number;
  value: number; // 評価額（円）
  currency: "USD" | "JPY" | null;
  yahooSymbol: string | null;
  perShareTtm: number | null; // 直近12ヶ月の1株あたり配当合計（現地通貨）
  perShareMonthlyAvg: number | null; // 直近3ヶ月の月平均（現地通貨）
  annualAmountJpy: number | null; // 年間見込み（円・整数）
  monthlyAmountJpy: number | null; // 直近3ヶ月平均ベースの月換算見込み（円・整数）
  yieldPct: number | null; // annualAmountJpy / value * 100
  resolved: boolean;
  reason: string | null; // 未解決・除外の理由
};

export type DividendMonthBucket = { month: string; amountJpy: number; confirmed: boolean };

export type DividendForecast = {
  fxUsdJpy: number | null;
  currentMonth: {
    month: string;
    confirmedJpy: number;
    estimatedJpy: number;
    totalJpy: number;
  };
  months: DividendMonthBucket[]; // 過去12ヶ月＋今後12ヶ月（昇順、"YYYY-MM"）
  thisYearJpy: number;
  lastYearJpy: number;
  next12MonthsJpy: number;
  rows: DividendForecastRow[];
  unresolved: Array<{ holdingName: string; category: string | null; reason: string }>;
};

/**
 * 保有銘柄名の正規化。
 * - 末尾の重複サフィックス `_2` / `_3` … を除去（`_1` は残す）
 * - 末尾の括弧注記 `（株式）` 等を除去
 * 例: `バンガード 米国高配当株式ETF（株式）_2` → `バンガード 米国高配当株式ETF`
 */
export function normalizeHoldingName(name: string): string {
  let result = name.trim();
  let previous: string;
  do {
    previous = result;
    // 末尾の括弧注記（全角/半角）
    result = result.replace(/[（(][^（()）]*[)）]\s*$/u, "").trim();
    // 末尾の重複サフィックス `_2` 以上
    const match = result.match(/_(\d+)\s*$/u);
    if (match && Number(match[1]) >= 2) {
      result = result.slice(0, match.index).trim();
    }
  } while (result !== previous);
  return result;
}

function coerceCurrency(value: string | null): "USD" | "JPY" | null {
  return value === "USD" || value === "JPY" ? value : null;
}

/** シンボルから通貨を推定（`.T` = 東証 = JPY、それ以外 = USD） */
function inferCurrency(symbol: string): "USD" | "JPY" {
  return symbol.endsWith(".T") ? "JPY" : "USD";
}

/** 月キー "YYYY-MM" から年・月を取り出す */
function monthParts(monthKey: string): { year: number; month: number } {
  return { year: Number(monthKey.slice(0, 4)), month: Number(monthKey.slice(5, 7)) };
}

function sumEvents(
  events: Array<{ exDate: string; amount: number }>,
  predicate: (exDate: string) => boolean,
): number {
  let total = 0;
  for (const event of events) {
    if (predicate(event.exDate)) total += event.amount;
  }
  return total;
}

/**
 * 暦月ごとの「1株あたり将来見込み額」を、同じ暦月の直近3イベントの平均から求める。
 * 例: KO の3月イベントが 0.48 / 0.51 / 0.53 なら 3月見込み = 0.5067。
 * 該当暦月の実績が無ければ 0（四半期払い銘柄は支払い月以外 0 になる）。
 * 戻り値は index 1〜12（index 0 は未使用）。
 */
function computeMonthlyPerShare(
  events: Array<{ exDate: string; amount: number }>,
): number[] {
  const byCalendarMonth = new Map<number, number[]>();
  for (const event of events) {
    const month = Number(event.exDate.slice(5, 7));
    const list = byCalendarMonth.get(month) ?? [];
    list.push(event.amount);
    byCalendarMonth.set(month, list);
  }
  const result = new Array<number>(13).fill(0);
  for (const [month, amounts] of byCalendarMonth) {
    const recent = amounts.slice(-3); // 同じ暦月の直近3回
    result[month] = recent.reduce((sum, amount) => sum + amount, 0) / recent.length;
  }
  return result;
}

/**
 * 指定した暦月(1〜12)の将来見込み額（円・未丸め）。
 * Yahoo 銘柄は暦月ごとの季節性見込み、手動設定の投信・年金は毎月均等に積む
 * （分配金の季節性情報が無いため月次均等と仮定する）。
 */
function futureMonthEstimate(
  calendarMonth: number,
  yahooRows: ResolvedYahooRow[],
  annualModeMonthlyTotal: number,
): number {
  let total = annualModeMonthlyTotal;
  for (const row of yahooRows) {
    total += row.monthlyPerShare[calendarMonth]! * row.quantity * row.fx;
  }
  return total;
}

/** holdings の最新 holding_values を駆動するサブクエリ（口座別 snapshot 対応） */
function latestHoldingValues(db: Db) {
  return db
    .select({
      holdingId: schema.holdingValues.holdingId,
      snapshotId: max(schema.holdingValues.snapshotId).as("snapshotId"),
    })
    .from(schema.holdingValues)
    .groupBy(schema.holdingValues.holdingId)
    .as("latest_dividend_hv");
}

/** 正規化名で合算した保有行 */
interface AggregatedHolding {
  holdingName: string;
  rawHoldingName: string;
  category: string | null;
  code: string | null;
  quantity: number;
  value: number;
}

/**
 * 保有銘柄を正規化名で合算する。
 * 同一基底名の holdings は数量・評価額を合計し、code / category は非 null のものを採用。
 */
function aggregateHoldings(
  rows: Array<{
    name: string;
    code: string | null;
    categoryName: string | null;
    holdingQuantity: number;
    valueQuantity: number | null;
    amount: number;
  }>,
): AggregatedHolding[] {
  const byName = new Map<string, AggregatedHolding>();
  for (const row of rows) {
    const holdingName = normalizeHoldingName(row.name);
    const quantity = row.valueQuantity ?? row.holdingQuantity ?? 0;
    const existing = byName.get(holdingName);
    if (existing) {
      existing.quantity += quantity;
      existing.value += row.amount;
      if (existing.code === null) existing.code = row.code;
      if (existing.category === null) existing.category = row.categoryName;
    } else {
      byName.set(holdingName, {
        holdingName,
        rawHoldingName: row.name,
        category: row.categoryName,
        code: row.code,
        quantity,
        value: row.amount,
      });
    }
  }
  return [...byName.values()];
}

/** 解決済みの Yahoo イベント駆動行（月次集計に使う内部表現） */
interface ResolvedYahooRow {
  symbol: string;
  currency: "USD" | "JPY";
  fx: number;
  quantity: number;
  monthlyAmountJpy: number;
  annualAmountJpy: number;
  events: Array<{ exDate: string; amount: number }>;
  /** 暦月ごとの1株あたり将来見込み額（index 1〜12、0 は未使用） */
  monthlyPerShare: number[];
}

export async function getDividendForecast(
  db: Db,
  opts: { now?: Date } = {},
): Promise<DividendForecast> {
  const now = opts.now ?? new Date();
  const todayKey = getJstTodayIsoDate(now);
  const currentMonthKey = getJstYearMonthKey(now);
  const { year: currentYear, month: currentMonthNum } = getJstDateParts(now);

  // 直近12ヶ月 / 直近3ヶ月の境界
  const ttmCutoff = addDaysToIsoDateKey(todayKey, -365);
  const last3MonthKeys = new Set([
    shiftYearMonthKey(currentMonthKey, -2),
    shiftYearMonthKey(currentMonthKey, -1),
    currentMonthKey,
  ]);

  // --- 入力データ読み込み ---------------------------------------------------
  const fxUsdJpy = await getFxRate(db, "USDJPY");

  const mappingRows = db.select().from(schema.dividendSymbols).all();
  const mappingByName = new Map(mappingRows.map((m) => [m.holdingName, m]));

  const eventRows = db.select().from(schema.dividendEvents).all();
  const eventsBySymbol = new Map<string, Array<{ exDate: string; amount: number }>>();
  for (const event of eventRows) {
    const list = eventsBySymbol.get(event.symbol) ?? [];
    list.push({ exDate: event.exDate, amount: event.amount });
    eventsBySymbol.set(event.symbol, list);
  }
  for (const list of eventsBySymbol.values()) {
    list.sort((a, b) => a.exDate.localeCompare(b.exDate));
  }

  const latest = latestHoldingValues(db);
  const holdingRows = db
    .select({
      name: schema.holdings.name,
      code: schema.holdings.code,
      categoryName: schema.assetCategories.name,
      holdingQuantity: schema.holdings.quantity,
      valueQuantity: schema.holdingValues.quantity,
      amount: schema.holdingValues.amount,
    })
    .from(schema.holdingValues)
    .innerJoin(
      latest,
      and(
        eq(schema.holdingValues.holdingId, latest.holdingId),
        eq(schema.holdingValues.snapshotId, latest.snapshotId),
      ),
    )
    .innerJoin(schema.holdings, eq(schema.holdings.id, schema.holdingValues.holdingId))
    .leftJoin(schema.assetCategories, eq(schema.assetCategories.id, schema.holdings.categoryId))
    .all();

  const aggregated = aggregateHoldings(holdingRows);

  // --- 銘柄ごとの解決 -------------------------------------------------------
  const rows: DividendForecastRow[] = [];
  const yahooRows: ResolvedYahooRow[] = [];
  let annualModeMonthlyTotal = 0;
  let annualModeAnnualTotal = 0;

  for (const holding of aggregated) {
    const base: DividendForecastRow = {
      holdingName: holding.holdingName,
      rawHoldingName: holding.rawHoldingName,
      category: holding.category,
      code: holding.code,
      quantity: holding.quantity,
      value: holding.value,
      currency: null,
      yahooSymbol: null,
      perShareTtm: null,
      perShareMonthlyAvg: null,
      annualAmountJpy: null,
      monthlyAmountJpy: null,
      yieldPct: null,
      resolved: false,
      reason: null,
    };

    // 1. 対象外カテゴリ
    if (holding.category === null || !TARGET_CATEGORIES.has(holding.category)) {
      base.reason = REASON_OUT_OF_SCOPE;
      rows.push(base);
      continue;
    }

    const mapping = mappingByName.get(holding.holdingName);

    // 2. 分配なし設定
    if (mapping && mapping.paysDistribution === false) {
      base.reason = REASON_NO_DISTRIBUTION;
      rows.push(base);
      continue;
    }

    // 3. 投信・ラップ: 1万口あたり年間分配金が設定されていれば Yahoo を使わない
    if (mapping && mapping.annualDistributionPerUnit !== null) {
      const currency = coerceCurrency(mapping.currency);
      const annualAmountJpy = Math.round(
        (mapping.annualDistributionPerUnit / 10000) * holding.quantity,
      );
      const monthlyAmountJpy = Math.round(annualAmountJpy / 12);
      base.currency = currency;
      base.annualAmountJpy = annualAmountJpy;
      base.monthlyAmountJpy = monthlyAmountJpy;
      base.yieldPct = holding.value === 0 ? null : (annualAmountJpy / holding.value) * 100;
      base.resolved = true;
      rows.push(base);
      annualModeMonthlyTotal += monthlyAmountJpy;
      annualModeAnnualTotal += annualAmountJpy;
      continue;
    }

    // 4. シンボル解決（dividend_symbols → holdings.code の順）
    //    判定は @asset-scraping/shared の toYahooSymbol に集約（東証の英数字コード含む）
    let symbol: string | null = null;
    let currency: "USD" | "JPY" | null = null;
    if (mapping?.yahooSymbol) {
      symbol = mapping.yahooSymbol;
      currency = coerceCurrency(mapping.currency) ?? inferCurrency(symbol);
    } else if (holding.code) {
      const resolved = toYahooSymbol(holding.code);
      if (resolved) {
        symbol = resolved.symbol;
        currency = resolved.currency;
      }
    }

    if (symbol === null || currency === null) {
      base.reason = REASON_UNRESOLVED_SYMBOL;
      rows.push(base);
      continue;
    }

    // 5. 為替レート解決（JPY = 1、USD = fx_rates）
    let fx: number;
    if (currency === "JPY") {
      fx = 1;
    } else if (fxUsdJpy !== null) {
      fx = fxUsdJpy;
    } else {
      base.yahooSymbol = symbol;
      base.currency = currency;
      base.reason = REASON_UNRESOLVED_FX;
      rows.push(base);
      continue;
    }

    // 6. TTM / 直近3ヶ月平均
    const events = eventsBySymbol.get(symbol) ?? [];
    const perShareTtm = sumEvents(events, (d) => d >= ttmCutoff && d <= todayKey);
    const last3Sum = sumEvents(events, (d) => last3MonthKeys.has(d.slice(0, 7)));
    const perShareMonthlyAvg = last3Sum / 3;

    const annualAmountJpy = Math.round(perShareTtm * holding.quantity * fx);
    const monthlyAmountJpy = Math.round(perShareMonthlyAvg * holding.quantity * fx);

    base.currency = currency;
    base.yahooSymbol = symbol;
    base.perShareTtm = perShareTtm;
    base.perShareMonthlyAvg = perShareMonthlyAvg;
    base.annualAmountJpy = annualAmountJpy;
    base.monthlyAmountJpy = monthlyAmountJpy;
    base.yieldPct = holding.value === 0 ? null : (annualAmountJpy / holding.value) * 100;
    base.resolved = true;
    rows.push(base);

    yahooRows.push({
      symbol,
      currency,
      fx,
      quantity: holding.quantity,
      monthlyAmountJpy,
      annualAmountJpy,
      events,
      monthlyPerShare: computeMonthlyPerShare(events),
    });
  }

  // --- 月別バケット（過去12ヶ月＋今後12ヶ月） ------------------------------
  // 実イベント（confirmed）を月別に集計する。
  const confirmedByMonth = new Map<string, number>();
  for (const row of yahooRows) {
    for (const event of row.events) {
      const monthKey = event.exDate.slice(0, 7);
      const current = confirmedByMonth.get(monthKey) ?? 0;
      confirmedByMonth.set(monthKey, current + event.amount * row.quantity * row.fx);
    }
  }

  const months: DividendMonthBucket[] = [];
  for (let offset = -11; offset <= 12; offset++) {
    const monthKey = shiftYearMonthKey(currentMonthKey, offset);
    if (offset > 0) {
      // 未来月: 同じ暦月の過去実績から季節性を反映した見込みを積む
      // （四半期払いなら支払い月のみ非ゼロ、毎月払いなら毎月ほぼ均等。
      //   手動設定の投信・年金は季節性情報が無いため毎月均等 = annualModeMonthlyTotal）
      months.push({
        month: monthKey,
        amountJpy: Math.round(
          futureMonthEstimate(monthParts(monthKey).month, yahooRows, annualModeMonthlyTotal),
        ),
        confirmed: false,
      });
    } else {
      months.push({
        month: monthKey,
        amountJpy: Math.round(confirmedByMonth.get(monthKey) ?? 0),
        confirmed: true,
      });
    }
  }

  // --- 当月 ---------------------------------------------------------------
  // 当月に ex-date がある銘柄は実イベント（confirmed）に、無い銘柄は「当月の季節性見込み」に算入。
  // 月割り平均（monthlyAmountJpy）は四半期払いでも毎月加算され過大になるため使わない。
  // 手動設定（annualModeMonthlyTotal）は季節性情報が無いので月次均等のまま。
  const confirmedJpy = Math.round(confirmedByMonth.get(currentMonthKey) ?? 0);
  let estimatedJpy = annualModeMonthlyTotal;
  for (const row of yahooRows) {
    const hasThisMonth = row.events.some((e) => e.exDate.slice(0, 7) === currentMonthKey);
    if (!hasThisMonth) {
      estimatedJpy += row.monthlyPerShare[currentMonthNum]! * row.quantity * row.fx;
    }
  }
  const totalJpy = confirmedJpy + Math.round(estimatedJpy);

  // --- 当年 / 昨年 ---------------------------------------------------------
  const confirmedYear = yahooRows.reduce((sum, row) => {
    const yearSum = sumEvents(row.events, (d) => d.startsWith(`${currentYear}-`));
    return sum + yearSum * row.quantity * row.fx;
  }, 0);
  // 当年: 実績 + 当年の残り月（当月の翌月〜12月）の暦月見込み。
  // 当月は confirmedYear に実績として含まれるため、残り月は当月の翌月から数えて二重計上しない。
  let remainingYearEstimate = 0;
  for (let month = currentMonthNum + 1; month <= 12; month++) {
    remainingYearEstimate += futureMonthEstimate(month, yahooRows, annualModeMonthlyTotal);
  }
  const thisYearJpy = Math.round(confirmedYear + remainingYearEstimate);

  // 昨年: 保有数量の履歴が無いため、昨年の実イベント合計に「現在の数量」を掛けた近似。
  const lastYearJpy = Math.round(
    yahooRows.reduce((sum, row) => {
      const yearSum = sumEvents(row.events, (d) => d.startsWith(`${currentYear - 1}-`));
      return sum + yearSum * row.quantity * row.fx;
    }, 0),
  );

  // --- 今後12ヶ月 / 未解決 -------------------------------------------------
  // 整合性メモ: 今後12ヶ月バケット合計と next12MonthsJpy（TTM 年間額）は概ね一致するが、
  // 完全一致しない場合がある:
  //  - 手動設定（annualDistributionPerUnit）は月次均等按分のためバケット12ヶ月分 = 年間額で一致
  //  - Yahoo 銘柄は「TTM 実績（直近365日）」と「暦月平均 × 12」が履歴不足・増配減配でずれる
  //    （直近1年に同じ暦月が2回/0回入る、金額変動など）
  const next12MonthsJpy =
    yahooRows.reduce((sum, row) => sum + row.annualAmountJpy, 0) + annualModeAnnualTotal;

  const unresolved = rows
    .filter((row) => !row.resolved)
    .map((row) => ({
      holdingName: row.holdingName,
      category: row.category,
      reason: row.reason ?? REASON_UNRESOLVED_SYMBOL,
    }));

  return {
    fxUsdJpy,
    currentMonth: {
      month: currentMonthKey,
      confirmedJpy,
      estimatedJpy,
      totalJpy,
    },
    months,
    thisYearJpy,
    lastYearJpy,
    next12MonthsJpy,
    rows,
    unresolved,
  };
}

export function getDividendMappings(db: Db) {
  const rows = db.select().from(schema.dividendSymbols).all();
  return Promise.resolve(
    rows.map((row) => ({
      holdingName: row.holdingName,
      yahooSymbol: row.yahooSymbol,
      currency: coerceCurrency(row.currency),
      annualDistributionPerUnit: row.annualDistributionPerUnit,
      paysDistribution: row.paysDistribution ?? true,
      note: row.note,
      updatedAt: row.updatedAt,
    })),
  );
}

export function getDividendEvents(db: Db, symbol?: string) {
  const query = db
    .select({
      symbol: schema.dividendEvents.symbol,
      exDate: schema.dividendEvents.exDate,
      amount: schema.dividendEvents.amount,
      currency: schema.dividendEvents.currency,
    })
    .from(schema.dividendEvents);
  const rows = symbol
    ? query.where(eq(schema.dividendEvents.symbol, symbol)).all()
    : query.all();
  return Promise.resolve(
    rows.sort((a, b) => a.exDate.localeCompare(b.exDate)),
  );
}

export function getFxRate(db: Db, pair: string): Promise<number | null> {
  const row = db
    .select({ rate: schema.fxRates.rate })
    .from(schema.fxRates)
    .where(eq(schema.fxRates.pair, pair))
    .get();
  return Promise.resolve(row?.rate ?? null);
}
