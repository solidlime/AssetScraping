import { useState, useCallback } from "react";

export function useCategoryExpansion() {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [expandedSubCategories, setExpandedSubCategories] = useState<Set<string>>(new Set());

  const toggleCategory = useCallback((category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }, []);

  const toggleSubCategory = useCallback((key: string) => {
    setExpandedSubCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const isCategoryExpanded = useCallback(
    (category: string) => expandedCategories.has(category),
    [expandedCategories],
  );

  const isSubCategoryExpanded = useCallback(
    (key: string) => expandedSubCategories.has(key),
    [expandedSubCategories],
  );

  return {
    toggleCategory,
    toggleSubCategory,
    isCategoryExpanded,
    isSubCategoryExpanded,
  };
}
