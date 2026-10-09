/** 本家 mf-dashboard の lib/url.ts 準拠（グループプレフィックス付きパス生成）。 */
export function buildGroupPath(groupId: string | null | undefined, path: string): string {
  if (groupId) {
    return path ? `/${groupId}/${path}` : `/${groupId}`;
  }
  return path ? `/${path}` : "/";
}
