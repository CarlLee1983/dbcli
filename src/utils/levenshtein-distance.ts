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
  // Initialize matrix with dimensions (b.length + 1) x (a.length + 1)
  const matrix: number[][] = []

  // Initialize first column (delete all characters from b)
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }

  // Initialize first row (insert all characters from a)
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }

  // Fill matrix using dynamic programming
  // Each cell (i, j) represents the distance between b[0...i-1] and a[0...j-1]
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        // Characters match: no operation needed
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        // Characters differ: take minimum of three operations
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // Substitution
          matrix[i][j - 1] + 1, // Insertion
          matrix[i - 1][j] + 1 // Deletion
        )
      }
    }
  }

  // Return distance between full strings
  return matrix[b.length][a.length]
}
