/**
 * repo.ts ensureDefaultGroup / linkAllAccountsToDefaultGroup の roundtrip テスト。
 * crawler 起動時に groups（固定 "default"）と group_accounts（全 accounts）を冪等 upsert する。
 */
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "../src/schema.ts";
import { closeTestDb, createTestDb, resetTestDb } from "../src/test-helpers.ts";
import {
  ensureDefaultGroup,
  linkAllAccountsToDefaultGroup,
  upsertAccount,
  type Database,
} from "../src/repo.ts";
import { getCurrentGroupId } from "../src/repositories/groups.ts";

const dbs: Database[] = [];

function freshDb(): Database {
  const db = createTestDb();
  dbs.push(db);
  return db;
}

afterAll(() => {
  for (const db of dbs) closeTestDb(db);
});

describe("default group seeding", () => {
  it("groups に固定 default 行を作成し isCurrent=true", () => {
    const db = freshDb();
    resetTestDb(db);

    ensureDefaultGroup(db);

    const groups = db.select().from(schema.groups).all();
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id: "default", name: "default", isCurrent: true });
    expect(getCurrentGroupId(db)).toBe("default");
  });

  it("再実行で二重登録しない（冪等）", () => {
    const db = freshDb();
    resetTestDb(db);

    ensureDefaultGroup(db);
    ensureDefaultGroup(db);

    expect(db.select().from(schema.groups).all()).toHaveLength(1);
  });

  it("全 accounts を default group に登録する（冪等）", () => {
    const db = freshDb();
    resetTestDb(db);

    upsertAccount(db, { id: "acc-1", name: "SMTB", institution: "SMTB", category: "bank" });
    upsertAccount(db, { id: "acc-2", name: "SBI", institution: "SBI", category: "securities" });

    ensureDefaultGroup(db);
    linkAllAccountsToDefaultGroup(db);

    let links = db.select().from(schema.groupAccounts).all();
    expect(links).toHaveLength(2);

    // 再実行・追加分も冪等に反映
    linkAllAccountsToDefaultGroup(db);
    upsertAccount(db, { id: "acc-3", name: "楽天", institution: "楽天", category: "securities" });
    linkAllAccountsToDefaultGroup(db);

    links = db.select().from(schema.groupAccounts).all();
    expect(links).toHaveLength(3);
    expect(new Set(links.map((l) => l.accountId))).toEqual(
      new Set(["acc-1", "acc-2", "acc-3"]),
    );
  });
});
