import type { Db, DbExecutor } from "../index.ts";
import { schema } from "../index.ts";
import { getOrCreate } from "../utils.ts";

/**
 * Get or create institution category by name
 * Returns the category ID
 */
export function getOrCreateInstitutionCategory(
  db: DbExecutor,
  categoryName: string,
): number {
  return getOrCreate(
    db,
    schema.institutionCategories,
    schema.institutionCategories.name,
    categoryName,
  );
}

/**
 * Get all institution categories
 */
export function getAllInstitutionCategories(db: Db) {
  return db
    .select()
    .from(schema.institutionCategories)
    .orderBy(schema.institutionCategories.displayOrder)
    .all();
}
