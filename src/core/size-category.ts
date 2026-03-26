export type SizeCategory = 'small' | 'medium' | 'large' | 'huge'

const THRESHOLDS: Array<[number, SizeCategory]> = [
  [1_000_000, 'huge'],
  [100_000, 'large'],
  [10_000, 'medium'],
]

export function getSizeCategory(estimatedRowCount: number | undefined | null): SizeCategory {
  const count = estimatedRowCount ?? 0
  for (const [threshold, category] of THRESHOLDS) {
    if (count >= threshold) return category
  }
  return 'small'
}
