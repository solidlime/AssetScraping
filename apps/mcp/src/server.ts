/**
 * MCP サーバー定義（read-only）。
 * ツール: get_accounts / get_transactions / get_holdings / get_asset_history / get_monthly_summary
 * DB は read-only 接続。更新トリガーは持たない（web UI に一元化）。
 * stdio / HTTP 両 transport から使うため、インスタンス生成を関数化している。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getAllAccountStatuses,
  getAllAccounts,
  getAssetHistory,
  getHoldings,
  getMonthlySummary,
  getTransactions,
} from "@asset-scraping/db";
import { dbTool } from "./tools.ts";

export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "asset-scraping", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.tool("get_accounts", "ssnb の口座一覧と現在残高を取得する", {}, () =>
    dbTool((db) => {
      const accounts = getAllAccounts(db);
      const statuses = new Map(getAllAccountStatuses(db).map((s) => [s.accountId, s]));
      return accounts.map((a) => ({
        id: a.id,
        name: a.name,
        institution: a.institution,
        category: a.category,
        balance: statuses.get(a.id)?.balance ?? null,
        scrapedAt: statuses.get(a.id)?.scrapedAt ?? null,
      }));
    }),
  );

  server.tool(
    "get_transactions",
    "取引履歴を取得する（limit / since で絞り込み）",
    {
      limit: z.number().int().min(1).max(1000).default(100).describe("最大件数"),
      since: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("この日付以降 (YYYY-MM-DD)"),
    },
    ({ limit, since }) => dbTool((db) => getTransactions(db, { limit, since })),
  );

  server.tool(
    "get_holdings",
    "保有資産（銘柄・数量・評価額・含み損益）を取得する",
    {
      accountId: z.string().optional().describe("口座 ID で絞り込み"),
    },
    ({ accountId }) => dbTool((db) => getHoldings(db, accountId)),
  );

  server.tool(
    "get_asset_history",
    "資産推移（日次 × カテゴリ別）を取得する",
    {
      since: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("この日付以降 (YYYY-MM-DD)"),
    },
    ({ since }) => dbTool((db) => getAssetHistory(db, { since })),
  );

  server.tool(
    "get_monthly_summary",
    "月次収支サマリー（収入・支出・収支）を取得する",
    {
      months: z.number().int().min(1).max(60).default(12).describe("直近 N ヶ月"),
    },
    ({ months }) => dbTool((db) => getMonthlySummary(db, { months })),
  );

  return server;
}
