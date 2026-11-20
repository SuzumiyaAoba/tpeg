const builtinTypes = new Set([
  "string",
  "number",
  "boolean",
  "bigint",
  "symbol",
  "object",
  "unknown",
  "any",
  "never",
  "void",
  "undefined",
  "null",
]);

// Match one complete string literal, rather than a union that happens to
// start and end in quotes. Emit this token unchanged in the equality check.
const stringLiteralType =
  /^(?:"(?:[^"\\\r\n]|\\[^\r\n])*"|'(?:[^'\\\r\n]|\\[^\r\n])*')$/;

export function isStringLiteralType(typeString: string): boolean {
  return stringLiteralType.test(typeString.trim());
}

/** Runtime shapes that can be derived from a mapping without type lookup. */
export function mappedBaseType(typeString: string): string | undefined {
  const type = typeString.trim();
  if (builtinTypes.has(type)) return type;
  if (isStringLiteralType(type)) return "string";
  return undefined;
}
