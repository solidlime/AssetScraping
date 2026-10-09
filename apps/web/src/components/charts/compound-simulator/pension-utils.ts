const EARLY_RATE_PER_MONTH = 0.004;
const LATE_RATE_PER_MONTH = 0.007;
const MIN_AGE = 60;
const MAX_AGE = 75;
const STANDARD_AGE = 65;

export function pensionMultiplier(startAge: number): number {
  const clamped = Math.max(MIN_AGE, Math.min(MAX_AGE, startAge));
  const diffMonths = (clamped - STANDARD_AGE) * 12;
  if (diffMonths < 0) {
    // 繰上げ: 1ヶ月あたり -0.4%
    return 1 + diffMonths * EARLY_RATE_PER_MONTH;
  }
  // 繰下げ: 1ヶ月あたり +0.7%
  return 1 + diffMonths * LATE_RATE_PER_MONTH;
}

export function adjustedPension(basePension: number, startAge: number): number {
  return Math.round(basePension * pensionMultiplier(startAge));
}
