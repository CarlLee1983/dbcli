/**
 * Fix double-encoded UTF-8 strings from MySQL/MariaDB.
 *
 * When UTF-8 bytes are inserted through a latin1 (cp1252) connection,
 * MySQL re-encodes them, producing "mojibake". This function detects
 * and reverses that double encoding.
 */

// Reverse map: Unicode codepoint → cp1252 byte value
// Only the 0x80–0x9F range differs from ISO-8859-1
const CP1252_REVERSE: Record<number, number> = {
  0x20AC: 0x80, // €
  0x201A: 0x82, // ‚
  0x0192: 0x83, // ƒ
  0x201E: 0x84, // „
  0x2026: 0x85, // …
  0x2020: 0x86, // †
  0x2021: 0x87, // ‡
  0x02C6: 0x88, // ˆ
  0x2030: 0x89, // ‰
  0x0160: 0x8A, // Š
  0x2039: 0x8B, // ‹
  0x0152: 0x8C, // Œ
  0x017D: 0x8E, // Ž
  0x2018: 0x91, // '
  0x2019: 0x92, // '
  0x201C: 0x93, // "
  0x201D: 0x94, // "
  0x2022: 0x95, // •
  0x2013: 0x96, // –
  0x2014: 0x97, // —
  0x02DC: 0x98, // ˜
  0x2122: 0x99, // ™
  0x0161: 0x9A, // š
  0x203A: 0x9B, // ›
  0x0153: 0x9C, // œ
  0x017E: 0x9E, // ž
  0x0178: 0x9F  // Ÿ
}

export function fixDoubleEncodedUtf8(str: string): string {
  if (!str) return str

  // Map each character to its cp1252 byte value
  const bytes: number[] = []
  for (const char of str) {
    const code = char.codePointAt(0)!
    if (code < 0x80) {
      bytes.push(code)
    } else if (code <= 0xFF) {
      bytes.push(code)
    } else {
      const cp1252Byte = CP1252_REVERSE[code]
      if (cp1252Byte !== undefined) {
        bytes.push(cp1252Byte)
      } else {
        // Character not in cp1252 — not double-encoded
        return str
      }
    }
  }

  // Try decoding the bytes as UTF-8
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes))
    // Only return decoded if it actually changed (avoids false positives for pure ASCII)
    if (decoded !== str) {
      return decoded
    }
  } catch {
    // Not valid UTF-8 bytes — not double-encoded
  }

  return str
}
