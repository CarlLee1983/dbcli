/**
 * Levenshtein distance utility for string similarity
 * Used for finding similar table names in error suggestions
 */

/**
 * Computes the Levenshtein distance between two strings
 * The Levenshtein distance is the minimum number of single-character edits
 * (insertions, deletions, substitutions) needed to change one string into another.
 *
 * This is used for intelligent error suggestions when a table name is misspelled.
 * A distance < 3 typically indicates a likely typo.
 *
 * Example: levenshteinDistance('users', 'usrs') returns 1 (one deletion)
 * Example: levenshteinDistance('kitten', 'sitting') returns 3 (classic case)
 *
 * @param a First string for comparison
 * @param b Second string for comparison
 * @returns The Levenshtein distance (minimum edits required)
 */
export function levenshteinDistance(a: string, b: string): number {
  const lenA = a.length
  const lenB = b.length

  // Create matrix for dynamic programming
  const dp: number[][] = []
  for (let i = 0; i <= lenB; i++) {
    const row: number[] = []
    for (let j = 0; j <= lenA; j++) {
      row[j] = 0
    }
    dp[i] = row
  }

  // Initialize first column and row
  for (let i = 0; i <= lenB; i++) {
    const row = dp[i]
    if (row !== undefined) {
      row[0] = i
    }
  }
  for (let j = 0; j <= lenA; j++) {
    const firstRow = dp[0]
    if (firstRow !== undefined) {
      firstRow[j] = j
    }
  }

  // Fill matrix using dynamic programming
  for (let i = 1; i <= lenB; i++) {
    const currentRow = dp[i]
    const prevRow = dp[i - 1]
    if (!currentRow || !prevRow) continue

    for (let j = 1; j <= lenA; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        // Characters match: no operation needed
        currentRow[j] = prevRow[j - 1] ?? 0
      } else {
        // Characters differ: take minimum of three operations
        const sub = (prevRow[j - 1] ?? 0) + 1
        const ins = (currentRow[j - 1] ?? 0) + 1
        const del = (prevRow[j] ?? 0) + 1
        currentRow[j] = Math.min(sub, ins, del)
      }
    }
  }

  // Return distance between full strings
  return dp[lenB]?.[lenA] ?? 0
}
