/**
 * 2つの月の間のすべての月を生成する（降順）
 * @param startMonth "YYYY-MM" 形式の開始月
 * @param endMonth "YYYY-MM" 形式の終了月
 * @returns 降順の月配列
 */
export function generateMonthRange(startMonth: string, endMonth: string): string[] {
  const months: string[] = [];
  const [startYear, startM] = startMonth.split("-").map(Number) as [number, number];
  const [endYear, endM] = endMonth.split("-").map(Number) as [number, number];

  let year = endYear;
  let month = endM;

  while (year > startYear || (year === startYear && month >= startM)) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    month--;
    if (month === 0) {
      month = 12;
      year--;
    }
  }

  return months;
}
