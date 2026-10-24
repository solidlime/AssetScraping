import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDb, schema, type Database } from "../src/index.js";
import { todayJst, saveScheduledWithdrawal } from "../src/repo.js";
import { getAccountAlerts, getWithdrawalAccountState, type AccountAlert } from "../src/repositories/alerts.js";
import {
  DEFAULT_WITHDRAWAL_ALERT_DAYS,
  getWithdrawalAccountId,
  getWithdrawalAlertDays,
  SETTING_KEYS,
  setSetting,
  setWithdrawalAccountId,
  setWithdrawalAlertDays,
} from "../src/repositories/settings.js";

let db: Database;

/** 口座 + 最新ステータスを投入するヘルパ */
function seedAccount(id: string, name: string, institution: string, balance: number, status: string | null = "ok", categoryId?: number): void {
  const ts = new Date().toISOString();
  db.insert(schema.accounts)
    .values({ id, name, institution, category: "bank", categoryId, createdAt: ts, updatedAt: ts })
    .onConflictDoUpdate({ target: schema.accounts.id, set: { name, categoryId, updatedAt: ts } })
    .run();
  db.insert(schema.accountStatuses)
    .values({ accountId: id, balance, scrapedAt: ts, status, createdAt: ts, updatedAt: ts })
    .onConflictDoUpdate({ target: schema.accountStatuses.accountId, set: { balance, status, updatedAt: ts } })
    .run();
}

beforeEach(() => {
  db = createDb({ path: ":memory:" });
  migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
});

/** today から days 日後の YYYY-MM-DD */
function dayOffset(days: number): string {
  const d = new Date(`${todayJst()}T00:00:00Z`);
  return new Date(d.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/** クレカ口座（category="card"・引き落とし予定額・予定日付き）を投入 */
function seedCard(
  id: string,
  name: string,
  opts: { amount: number | null; date: string | null },
): void {
  seedAccount(id, name, name, 0);
  db.update(schema.accounts).set({ category: "card" }).where(eq(schema.accounts.id, id)).run();
  db.update(schema.accountStatuses)
    .set({
      scheduledWithdrawalAmount: opts.amount,
      scheduledWithdrawalDate: opts.date,
      scheduledWithdrawalConfirmed: opts.amount !== null && opts.date !== null,
    })
    .where(eq(schema.accountStatuses.accountId, id))
    .run();
}

describe("getAccountAlerts", () => {
  it("しきい値以下の口座を low_balance として返す", () => {
    seedAccount("acc-1", "青空銀行", "青空銀行", 99_999);
    seedAccount("acc-2", "証券会社", "証券会社", 100_001);
    const alerts = getAccountAlerts(db, { threshold: 100_000 });
    expect(alerts).toEqual([
      { kind: "low_balance", accountId: "acc-1", accountName: "青空銀行", institution: "青空銀行", balance: 99_999, status: "ok" },
    ]);
  });

  it("しきい値ちょうど・負残高も low_balance（本家 <= 判定踏襲）", () => {
    seedAccount("acc-eq", "ちょうど口座", "銀行", 100_000);
    seedAccount("acc-neg", "マイナス口座", "カード", -5_000);
    const kinds = new Map(
      getAccountAlerts(db, { threshold: 100_000 }).map((a: AccountAlert) => [a.accountId, a.kind]),
    );
    expect(kinds.get("acc-eq")).toBe("low_balance");
    expect(kinds.get("acc-neg")).toBe("low_balance");
  });

  it("エラー・更新中・停止口座を account_status として返す（残高しきい値以上でも）", () => {
    seedAccount("acc-err", "エラー口座", "銀行", 500_000, "error");
    seedAccount("acc-upd", "更新中口座", "銀行", 500_000, "updating");
    seedAccount("acc-sus", "停止中口座", "銀行", 500_000, "suspended");
    const alerts = getAccountAlerts(db, { threshold: 100_000 });
    const kinds = new Map(alerts.map((a) => [a.accountId, a.kind]));
    expect(kinds.get("acc-err")).toBe("account_status");
    expect(kinds.get("acc-upd")).toBe("account_status");
    expect(kinds.get("acc-sus")).toBe("account_status");
  });

  it("両方該当の口座は重複せず 1 件（low_balance 優先）", () => {
    seedAccount("acc-both", "両方口座", "銀行", 50_000, "error");
    const alerts = getAccountAlerts(db, { threshold: 100_000 });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.kind).toBe("low_balance");
  });

  it("kind ソート: low_balance → account_status、同種内は残高昇順", () => {
    seedAccount("acc-a", "A", "銀行", 80_000);
    seedAccount("acc-b", "B", "銀行", 10_000);
    seedAccount("acc-err", "E", "銀行", 900_000, "error");
    seedAccount("acc-upd", "U", "銀行", 100, "updating");
    const alerts = getAccountAlerts(db, { threshold: 100_000 });
    expect(alerts.map((a) => a.accountId)).toEqual(["acc-upd", "acc-b", "acc-a", "acc-err"]);
  });

  it("threshold 未指定は DB 設定値から既定値が使われる", () => {
    seedAccount("acc-1", "A", "銀行", 99_999);
    expect(getAccountAlerts(db)).toEqual([
      { kind: "low_balance", accountId: "acc-1", accountName: "A", institution: "銀行", balance: 99_999, status: "ok" },
    ]);
  });

  it("ステータス unknown な行は low_balance のみで返す（unknown 自体は警告しない）", () => {
    seedAccount("acc-u", "A", "銀行", 0, null);
    const alerts = getAccountAlerts(db, { threshold: 100_000 });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.kind).toBe("low_balance");
  });

  it("threshold 設定省略時に low_balance_threshold 設定キーを参照する", () => {
    setSetting(db, SETTING_KEYS.lowBalanceThreshold, "42");
    seedAccount("acc-1", "A", "銀行", 43);
    expect(getAccountAlerts(db)).toHaveLength(0); // 43 > 42 は非対象
    seedAccount("acc-2", "B", "銀行", 42);
    const alerts = getAccountAlerts(db);
    expect(alerts).toHaveLength(1); // 42 <= 42
    expect(alerts[0]?.kind).toBe("low_balance");
  });
});

// F7: クレカ引き落とし警告。threshold: -1 で low_balance を無効化し、新 kind だけを見る
describe("getAccountAlerts / scheduled_withdrawal", () => {
  /** 銀行カテゴリ（引き落とし口座の合計対象）を投入し、その口座 ID を返す */
  function seedBankCategory(): number {
    const ts = new Date().toISOString();
    db.insert(schema.institutionCategories)
      .values({ name: "銀行", displayOrder: 1, createdAt: ts, updatedAt: ts })
      .run();
    return db.select({ id: schema.institutionCategories.id }).from(schema.institutionCategories).get()!.id;
  }

  const scheduledKinds = () =>
    getAccountAlerts(db, { threshold: -1 }).filter((a) => a.kind === "scheduled_withdrawal");

  it("引き落とし予定額が残高を超え、N 日以内なら警告する（不足額付き）", () => {
    seedAccount("bank-1", "青空銀行", "青空銀行", 30_000, "ok", seedBankCategory());
    seedCard("card-1", "三井住友カード", { amount: 75_267, date: dayOffset(3) });
    const alerts = getAccountAlerts(db, { threshold: -1 });
    const card = alerts.find((a) => a.kind === "scheduled_withdrawal");
    expect(card).toMatchObject({
      kind: "scheduled_withdrawal",
      accountId: "card-1",
      accountName: "三井住友カード",
      scheduledWithdrawalAmount: 75_267,
      scheduledWithdrawalDate: dayOffset(3),
      shortage: 45_267,
    });
  });

  it("残高が足りるなら警告しない", () => {
    seedAccount("bank-1", "青空銀行", "青空銀行", 100_000, "ok", seedBankCategory());
    seedCard("card-1", "三井住友カード", { amount: 75_267, date: dayOffset(3) });
    expect(scheduledKinds()).toHaveLength(0);
  });

  it("期日が N 日を超えて先なら警告しない", () => {
    seedAccount("bank-1", "青空銀行", "青空銀行", 0, "ok", seedBankCategory());
    seedCard("card-1", "三井住友カード", { amount: 75_267, date: dayOffset(8) });
    expect(scheduledKinds()).toHaveLength(0);
  });

  it("金額が欠損なら警告しない（誤警告より無警告）", () => {
    seedAccount("bank-1", "青空銀行", "青空銀行", 0, "ok", seedBankCategory());
    seedCard("card-1", "三井住友カード", { amount: null, date: dayOffset(1) });
    expect(scheduledKinds()).toHaveLength(0);
  });

  it("期日が欠損なら警告しない", () => {
    seedAccount("bank-1", "青空銀行", "青空銀行", 0, "ok", seedBankCategory());
    seedCard("card-1", "三井住友カード", { amount: 75_267, date: null });
    expect(scheduledKinds()).toHaveLength(0);
  });

  it("引き落とし日を過ぎた予定は警告しない", () => {
    seedAccount("bank-1", "青空銀行", "青空銀行", 0, "ok", seedBankCategory());
    seedCard("card-1", "三井住友カード", { amount: 75_267, date: dayOffset(-1) });
    expect(scheduledKinds()).toHaveLength(0);
  });

  it("withdrawal_alert_days 設定で期日の範囲が変わる", () => {
    seedAccount("bank-1", "青空銀行", "青空銀行", 0, "ok", seedBankCategory());
    seedCard("card-1", "三井住友カード", { amount: 75_267, date: dayOffset(20) });
    expect(scheduledKinds()).toHaveLength(0);
    setSetting(db, SETTING_KEYS.withdrawalAlertDays, "21");
    expect(scheduledKinds()).toHaveLength(1);
  });

  it("withdrawal_account_id 指定時はその口座の残高で比較する", () => {
    const bankCat = seedBankCategory();
    seedAccount("bank-1", "青空銀行", "青空銀行", 10_000, "ok", bankCat);
    seedAccount("bank-2", "みどり銀行", "みどり銀行", 200_000, "ok", bankCat);
    seedCard("card-1", "三井住友カード", { amount: 75_267, date: dayOffset(3) });
    // 未設定（銀行合計 210_000）なら足りる
    expect(scheduledKinds()).toHaveLength(0);
    setSetting(db, SETTING_KEYS.withdrawalAccountId, "bank-1");
    expect(scheduledKinds()).toHaveLength(1);
  });

  it("withdrawal_account_id にカード口座を指定されても無視する（存在しない不足額を作らない）", () => {
    seedAccount("bank-1", "青空銀行", "青空銀行", 200_000);
    seedCard("card-1", "三井住友カード", { amount: 75_267, date: dayOffset(3) });
    setSetting(db, SETTING_KEYS.withdrawalAccountId, "card-1");
    // カードの残高で判定すると 75,267 - 0 = 75,267 の嘘が出る。自動解決（銀行1つ）に落ちて足りる
    expect(scheduledKinds()).toHaveLength(0);
    expect(getWithdrawalAccountState(db)).toMatchObject({ status: "single", accountName: "青空銀行", balance: 200_000 });
  });

  it("予定額だけを持つ行は category が未更新でもカードとして除外される（NAS 実 DB の現状）", () => {
    // seedAccount は category="bank" を入れる。NAS 実 DB のクレカ口座は category が未更新のまま
    // scheduledWithdrawalAmount だけが立っているので、isCardRow の "!== null" 単独経路を踏む。
    seedAccount("bank-1", "青空銀行", "青空銀行", 200_000);
    seedAccount("card-1", "三井住友カード", "三井住友カード", 0);
    db.update(schema.accountStatuses)
      .set({ scheduledWithdrawalAmount: 75_267, scheduledWithdrawalDate: dayOffset(3) })
      .where(eq(schema.accountStatuses.accountId, "card-1"))
      .run();
    // 未設定なら banks にカードが混ざらず「銀行1つ」で解決される
    expect(getWithdrawalAccountState(db)).toMatchObject({ status: "single", accountName: "青空銀行", balance: 200_000 });
    // 明示指定してもカード行なので弾かれ、自動解決に落ちる（偽の不足額を作らない）
    setSetting(db, SETTING_KEYS.withdrawalAccountId, "card-1");
    expect(getWithdrawalAccountState(db)).toMatchObject({ status: "single", accountName: "青空銀行", balance: 200_000 });
    expect(scheduledKinds()).toHaveLength(0);
  });

  it("存在しない口座 ID を指定されても自動解決に落ちる", () => {
    seedAccount("bank-1", "青空銀行", "青空銀行", 30_000);
    seedCard("card-1", "三井住友カード", { amount: 75_267, date: dayOffset(3) });
    setSetting(db, SETTING_KEYS.withdrawalAccountId, "no-such-account");
    const alert = scheduledKinds()[0];
    expect(alert?.balance).toBe(30_000);
    expect(alert?.shortage).toBe(45_267);
  });

  it("セレクトの「未設定」センチネル (\"none\") は null として保存される", () => {
    setWithdrawalAccountId(db, "none");
    expect(getWithdrawalAccountId(db)).toBeNull();
  });

  it("institution_categories が未充填でも accounts.category=\"bank\" の残高で判定する（本番 DB の実態）", () => {
    // カテゴリマスタを作らずに銀行を seed（NAS 実 DB と同じ状況）。銀行が1つなので既定で使う
    seedAccount("bank-1", "青空銀行", "青空銀行", 30_000);
    seedCard("card-1", "三井住友カード", { amount: 75_267, date: dayOffset(3) });
    const alerts = scheduledKinds();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.shortage).toBe(45_267);
    expect(alerts[0]?.balance).toBe(30_000); // 判定に使った口座の残高（カード自身の負債ではない）
  });

  it("未設定で銀行が1つだけならその口座で判定し、注意書きを付ける", () => {
    seedAccount("bank-1", "青空銀行", "青空銀行", 30_000);
    seedCard("card-1", "三井住友カード", { amount: 75_267, date: dayOffset(3) });
    const alert = scheduledKinds()[0];
    expect(alert?.withdrawalAccountName).toBe("青空銀行");
    // G: 口座名は withdrawalAccountName 側だけで出す（note に重ねない）
    expect(alert?.note).toBe("（引き落とし口座が未設定のため自動判定）");
    expect(alert?.note).not.toContain("青空銀行");
  });

  it("未設定で銀行が複数なら警告しない（合算しない・未設定状態を返す）", () => {
    seedAccount("bank-1", "青空銀行", "青空銀行", 10_000);
    seedAccount("bank-2", "みどり銀行", "みどり銀行", 200_000);
    seedCard("card-1", "三井住友カード", { amount: 75_267, date: dayOffset(3) });
    // 合算（210_000）すれば足りてしまうが、合算判定はしない
    expect(scheduledKinds()).toHaveLength(0);
    expect(getWithdrawalAccountState(db)).toEqual({
      status: "ambiguous",
      accountId: null,
      accountName: null,
      balance: null,
    });
  });

  it("カード自身の残高は判定残高に混入しない（category=\"card\" は銀行扱いしない）", () => {
    // bank カテゴリの口座が無く、カードの負債残高だけが大きい状況
    seedAccount("card-1", "三井住友カード", "三井住友カード", 500_000);
    db.update(schema.accounts).set({ category: "card" }).where(eq(schema.accounts.id, "card-1")).run();
    db.update(schema.accountStatuses)
      .set({ scheduledWithdrawalAmount: 75_267, scheduledWithdrawalDate: dayOffset(3) })
      .where(eq(schema.accountStatuses.accountId, "card-1"))
      .run();
    expect(scheduledKinds()).toHaveLength(0);
    expect(getWithdrawalAccountState(db).status).toBe("none");
  });

  it("saveScheduledWithdrawal(null) で古い予定がクリアされ、警告が消える", () => {
    seedAccount("bank-1", "青空銀行", "青空銀行", 30_000);
    seedCard("card-1", "三井住友カード", { amount: 75_267, date: dayOffset(3) });
    expect(scheduledKinds()).toHaveLength(1);
    // ssnb が「未定」に戻った状況
    saveScheduledWithdrawal(db, { accountId: "card-1", amount: null, date: null });
    expect(scheduledKinds()).toHaveLength(0);
  });

  it("引き落とし警告の日数は 1〜30 にクランプされる（不正値は既定）", () => {
    expect(getWithdrawalAlertDays(db)).toBe(DEFAULT_WITHDRAWAL_ALERT_DAYS);
    setSetting(db, SETTING_KEYS.withdrawalAlertDays, "365");
    expect(getWithdrawalAlertDays(db)).toBe(30);
    setSetting(db, SETTING_KEYS.withdrawalAlertDays, "0");
    expect(getWithdrawalAlertDays(db)).toBe(1);
    setSetting(db, SETTING_KEYS.withdrawalAlertDays, "abc");
    expect(getWithdrawalAlertDays(db)).toBe(DEFAULT_WITHDRAWAL_ALERT_DAYS);
    setWithdrawalAlertDays(db, 14);
    expect(getWithdrawalAlertDays(db)).toBe(14);
    expect(() => setWithdrawalAlertDays(db, 0)).toThrow(/1〜30/);
    expect(() => setWithdrawalAlertDays(db, 31)).toThrow(/1〜30/);
  });

  it("既存 kind の判定結果は変わらない（引き落とし列が入っても）", () => {
    seedAccount("bank-1", "青空銀行", "青空銀行", 50_000, "ok", seedBankCategory());
    seedCard("card-1", "三井住友カード", { amount: 75_267, date: dayOffset(3) });
    const alerts = getAccountAlerts(db, { threshold: 100_000 });
    const lowBalanceIds = alerts.filter((a) => a.kind === "low_balance").map((a) => a.accountId);
    // 既存の low_balance 集合は変わらない（引き落とし警告は別 kind で併存する）
    expect(lowBalanceIds.sort()).toEqual(["bank-1", "card-1"]);
    expect(alerts.map((a) => a.kind)).toEqual([
      "low_balance",
      "low_balance",
      "scheduled_withdrawal",
    ]);
  });
});
