/**
 * 取引の内容ベースカテゴリ推定。
 *
 * 背景: ssnb /cf の取引明細には本家 MF の大項目・中項目列が実質無く
 * （2026-10 実測、.data DB では category が全行 null）、cf のカテゴリ内訳が
 * 「その他」100% になる。本家 mf-dashboard は MF 側のカテゴリ列 +
 * category-decision エンジン（LLM/ルール）で分類するが、ssnb には列が無いため
 * 本家 seed/transactions.ts のカテゴリ体系（大項目/中項目）をキーワードで推定する
 * 最小限実装に留める。判定不能は null（web 側の「未分類/その他」扱いに任せる）。
 *
 * 本家 seed の大項目は packages/meta/src/categories.ts EXPENSE_LARGE_CATEGORIES +
 * INCOME_LARGE_CATEGORIES に準拠する（web lib/colors.ts の色マップと同じ体系）。
 */

export interface TransactionCategory {
  /** 本家大項目（EXPENSE_LARGE_CATEGORIES / INCOME_LARGE_CATEGORIES 準拠） */
  category: string;
  /** 本家中項目相当（seed/transactions.ts の subCategory 文言） */
  subCategory: string;
}

/** [category, subCategory, キーワード群]。先勝ち（上から優先） */
const RULES: Array<[string, string, string[]]> = [
  // 収入系
  ["収入", "給与", ["給与", "給料", "salary", "報酬", "賞与"]],
  ["収入", "利息", ["利息"]],
  ["収入", "臨時収入", ["還付", "返金", "refund", "キャッシュバック"]],
  // 住宅
  ["住宅", "住居費", ["家賃", "賃貸", "賃借", "管理費", "roost"]],
  // 水道・光熱費
  ["水道・光熱費", "電気", ["電力", "東京電力", "関西電力", "中部電力", "電気"]],
  ["水道・光熱費", "ガス", ["ガス", "gas", "東京ガス", "大阪ガス"]],
  ["水道・光熱費", "水道", ["水道"]],
  // 通信費
  ["通信費", "携帯・電話", ["docomo", "ドコモ", "ahamo", "softbank", "ソフトバンク", "au ", "povo", "楽天モバイル", "電話"]],
  ["通信費", "インターネット", ["インターネット", "光回線", "ネクシート", "nuro", "フレッツ"]],
  ["通信費", "サブスクリプション", ["netflix", "spotify", "amazon prime", "prime video", "サブスク"]],
  // 日用品
  ["日用品", "ドラッグストア", ["ドラッグ", "ウエルシア", "ツルハ", "マツモト"]],
  ["日用品", "日用品", ["百円", "無印", "ニトリ", "amazon"]],
  // 食費（外食を食料品より先に置かない: ラクテンイチバ等の実測は青果市場）
  ["食費", "カフェ", ["スターバックス", "タリーズ", "ドトール", "カフェ", "coffee", "コーヒー", "スタバ"]],
  ["食費", "食料品", ["スーパー", "スーパーマーケット", "イトーヨーカドー", "イオン", "西友", "ライフ", "マルエツ", "業務スーパー", "食料品", "八百", "青果", "ラクテンイチバ", "ラクテン市場"]],
  ["食費", "外食", ["レストラン", "食堂", "定食", "ラーメン", "すき家", "松屋", "吉野家", "マクドナルド", "ドミノ", "ピザ", "うどん", "そば", "寿司", "焼肉", "居酒屋", "カレー", "バーガー", "ケンタッキー", "外食"]],
  // 衣服・美容
  ["衣服・美容", "衣服", ["ユニクロ", "gu", "zara", "しまむら", "洋服", "衣類", "服"]],
  ["衣服・美容", "美容", ["美容", "理容", "散髪", "ヘア", "cosme", "ドラッグストア"]],
  // 健康・医療
  ["健康・医療", "医療費", ["病院", "内科", "歯科", "外科", "クリニック", "診察", "処方", "薬局", "調剤"]],
  // 交通費
  ["交通費", "電車", ["jr", "jr東日本", "jr西日本", "メトロ", "地下鉄", "suica", "pasmo", "ica", "駅"]],
  ["交通費", "バス", ["バス", "bus"]],
  ["交通費", "タクシー", ["タクシー", "taxi", "ubER"]],
  ["交通費", "航空", ["航空", "ana", "jal", "skymark", "flight"]],
  // 趣味・娯楽（VISA/PAYPAL 等のカードプレフィックスより先に内容で判定する）
  ["趣味・娯楽", "その他", ["patreon", "pixiv", "steam", "ゲーム", "game", "nintendo", "playstation", "映画", "シネマ", "カラオケ", "book", "本", "楽天ブックス", "amazon kindle", "google", "youtube", "netflix", "hulu", "disney"]],
  // 教養・教育
  ["教養・教育", "書籍", ["技術書", "参考書", "書店", "udemy", "書籍"]],
  ["教養・教育", "学習", ["学習", "講座", "セミナー", "受験", "塾"]],
  // 税・社会保障
  ["税・社会保障", "税", ["国税", "納税", "税務", "住民税", "所得税", "消費税"]],
  ["税・社会保障", "社会保障", ["国民健康保険", "健康保険", "年金", "国民年金", "厚生"]],
  // 現金・カード（実態カテゴリは内容側で決まるため、純粋なカード系語のみ最後に回す。visa は入れない: "VISA国内利用" は単なる経路情報）
  ["現金・カード", "カード引落", ["カード引落", "カード 引落", "引き落とし", "クレジット", "mastercard", "jcb"]],
  ["現金・カード", "atm出金", ["atm", "出金", "キャッシング"]],
];

/**
 * 取引の内容（description）からカテゴリを推定する。
 * 判定不能は null — null の行は呼び出し側（upsertTransactions）で category null の
 * まま保存し、web 側の既存フォールバック（「その他/未分類」表示）に任せる。
 */
export function categorizeTransaction(description: string): TransactionCategory | null {
  const normalized = description.toLowerCase();
  for (const [category, subCategory, keywords] of RULES) {
    for (const keyword of keywords) {
      if (normalized.includes(keyword.toLowerCase())) {
        return { category, subCategory };
      }
    }
  }
  return null;
}
