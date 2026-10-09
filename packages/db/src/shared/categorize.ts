/**
 * db 側の取引カテゴリ推定（crawler src/categorize.ts と同じ本家 seed カテゴリ体系の
 * 薄いコピー）。crawler が category 付きで保存した行はこれを使わない。
 * 既存行（category null）の再 upsert 時に補完するためのフォールバック。
 *
 * 本家: mf-dashboard packages/meta/src/categories.ts の大項目 +
 * seed/transactions.ts の中項目文言。
 */
export interface DbTransactionCategory {
  category: string;
  subCategory: string;
}

const DB_CATEGORIZE_RULES: Array<[string, string, string[]]> = [
  ["収入", "給与", ["給与", "給料", "salary", "報酬", "賞与"]],
  ["収入", "利息", ["利息"]],
  ["収入", "臨時収入", ["還付", "返金", "refund", "キャッシュバック"]],
  ["住宅", "住居費", ["家賃", "賃貸", "賃借", "管理費"]],
  ["水道・光熱費", "電気", ["電力", "東京電力", "関西電力", "中部電力", "電気"]],
  ["水道・光熱費", "ガス", ["ガス", "gas", "東京ガス", "大阪ガス"]],
  ["水道・光熱費", "水道", ["水道"]],
  ["通信費", "携帯・電話", ["docomo", "ドコモ", "ahamo", "softbank", "ソフトバンク", "povo", "楽天モバイル", "電話"]],
  ["通信費", "インターネット", ["インターネット", "光回線", "nuro", "フレッツ"]],
  ["通信費", "サブスクリプション", ["netflix", "spotify", "amazon prime", "prime video", "サブスク"]],
  ["日用品", "ドラッグストア", ["ドラッグ", "ウエルシア", "ツルハ", "マツモト"]],
  ["日用品", "日用品", ["百円", "無印", "ニトリ", "amazon"]],
  ["食費", "カフェ", ["スターバックス", "タリーズ", "ドトール", "カフェ", "coffee", "コーヒー", "スタバ"]],
  ["食費", "食料品", ["スーパー", "イトーヨーカドー", "イオン", "西友", "ライフ", "マルエツ", "業務スーパー", "食料品", "八百", "青果", "ラクテンイチバ", "ラクテン市場"]],
  ["食費", "外食", ["レストラン", "食堂", "定食", "ラーメン", "すき家", "松屋", "吉野家", "マクドナルド", "ピザ", "うどん", "そば", "寿司", "焼肉", "居酒屋", "カレー", "外食"]],
  ["衣服・美容", "衣服", ["ユニクロ", "gu", "zara", "しまむら", "洋服", "衣類"]],
  ["衣服・美容", "美容", ["美容", "理容", "散髪", "ヘア", "cosme"]],
  ["健康・医療", "医療費", ["病院", "内科", "歯科", "外科", "クリニック", "診察", "処方", "薬局", "調剤"]],
  ["交通費", "電車", ["jr", "メトロ", "地下鉄", "suica", "pasmo", "駅"]],
  ["交通費", "バス", ["バス", "bus"]],
  ["交通費", "タクシー", ["タクシー", "taxi"]],
  ["交通費", "航空", ["航空", "ana", "jal", "skymark"]],
  ["趣味・娯楽", "その他", ["patreon", "pixiv", "steam", "ゲーム", "game", "nintendo", "playstation", "映画", "カラオケ", "book", "本", "楽天ブックス", "google", "youtube", "hulu", "disney"]],
  ["教養・教育", "書籍", ["技術書", "参考書", "書店", "udemy", "書籍"]],
  ["教養・教育", "学習", ["学習", "講座", "セミナー", "受験", "塾"]],
  ["税・社会保障", "税", ["国税", "納税", "税務", "住民税", "所得税", "消費税"]],
  ["税・社会保障", "社会保障", ["国民健康保険", "健康保険", "年金", "国民年金", "厚生"]],
  ["現金・カード", "カード引落", ["カード引落", "カード 引落", "引き落とし", "クレジット", "mastercard", "jcb"]],
  ["現金・カード", "atm出金", ["atm", "出金", "キャッシング"]],
];

/**
 * 取引の内容（description）からカテゴリを推定する。判定不能は null。
 */
export function categorizeDbTransaction(description: string): DbTransactionCategory | null {
  const normalized = description.toLowerCase();
  for (const [category, subCategory, keywords] of DB_CATEGORIZE_RULES) {
    for (const keyword of keywords) {
      if (normalized.includes(keyword.toLowerCase())) {
        return { category, subCategory };
      }
    }
  }
  return null;
}
