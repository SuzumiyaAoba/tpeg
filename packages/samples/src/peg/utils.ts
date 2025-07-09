/**
 * Converts octal digit string to character.
 * 
 * This utility function converts a string of octal digits to its corresponding
 * character using the octal number system (base-8).
 * 
 * @param str - The octal digit string to convert (e.g., "141" for 'a')
 * @returns The character corresponding to the octal digits
 * 
 * @example
 * ```typescript
 * octalDigitsToChar("141"); // "a"
 * octalDigitsToChar("101"); // "A"
 * octalDigitsToChar("40");  // " "
 * ```
 */
export const octalDigitsToChar = (str: string): string => {
  return String.fromCharCode(Number.parseInt(str, 8));
};
