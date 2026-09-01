import { foldCase } from '@/utils/case-fold'

/**
 * The one fold a blacklist comparison applies to a column or field name.
 *
 * A rule and the name it is compared against are folded here, at the
 * comparison, and never on the way into `BlacklistManager`'s state: the first
 * repair attempt in ADR-0018 folded at storage and every configuration still
 * leaked, because the masking path compared a returned name as written against
 * a rule that had been lower-cased. Two sides folding differently is the whole
 * failure, so there is exactly one function and every side calls it.
 *
 * The whole path folds, not the first segment alone. ADR-0018 kept later
 * segments case-sensitive because they are nested object keys rather than SQL
 * identifiers; ADR-0020 supersedes that, because the write side folded the
 * whole path regardless and the disagreement meant `profile.ssn` refused a
 * write of `profile.SSN` and returned it on the read that followed. The cost is
 * accepted and stated there: a document carrying both `profile.SSN` and
 * `profile.ssn` has both redacted by a rule naming either.
 *
 * 折疊本身在 `foldCase`（`src/utils/case-fold.ts`），`globMatches` 的
 * `caseInsensitive` 也呼叫它：兩側折出同一個答案才是一套規則，而
 * `toLowerCase` 單獨用不是——它的 `Final_Sigma` 規則看上下文，整串折與逐字折
 * 對同一個 `Σ` 給出不同的字元。
 *
 * Glob rules do not come through here — a pattern's text must not be rewritten,
 * since lower-casing `[A-z]` narrows the set it stands for. They fold inside
 * `globMatches` via its `caseInsensitive` option instead, which is the same
 * rule applied where the characters are compared.
 */
export function foldFieldPath(path: string): string {
  return foldCase(path)
}
