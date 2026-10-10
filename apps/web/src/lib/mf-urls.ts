/** 本家 mf-dashboard packages/meta の urls.ts 準拠。 */
const BASE_URL = "https://moneyforward.com";

export const mfUrls = {
  home: `${BASE_URL}/`,
  cashFlow: `${BASE_URL}/cf`,
  monthlyCashFlow: `${BASE_URL}/cf/monthly`,
  assetHistory: `${BASE_URL}/bs/history`,
  portfolio: `${BASE_URL}/bs/portfolio`,
  liability: `${BASE_URL}/bs/liability`,
  accounts: `${BASE_URL}/accounts`,
  /** 口座詳細ページURL を生成 */
  accountDetail(mfId: string, type: "show" | "show_manual" = "show"): string {
    return `${BASE_URL}/accounts/${type}/${mfId}`;
  },
} as const;
