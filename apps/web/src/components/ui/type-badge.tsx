import { Badge } from "./badge";

interface TypeBadgeProps {
  type: string;
  isTransfer: boolean | null;
}

export function TypeBadge({ type, isTransfer }: TypeBadgeProps) {
  if (isTransfer) {
    return <Badge variant="outline">振替</Badge>;
  }
  switch (type) {
    case "income":
      return <Badge variant="success">収入</Badge>;
    case "expense":
      return <Badge variant="destructive">支出</Badge>;
    default:
      return <Badge variant="secondary">{type}</Badge>;
  }
}
