/**
 * An atom: a symbol, a string literal, or a number.
 */
export type SAtom =
  | { readonly type: "symbol"; readonly name: string }
  | { readonly type: "string"; readonly value: string }
  | { readonly type: "number"; readonly value: number };

/**
 * An S-expression: either an atom or a list of S-expressions.
 */
export type SExp = SAtom | readonly SExp[];

// Convenience constructors, exported for consumers building S-expressions
// programmatically (e.g. an evaluator feeding parse output back in).
export const sym = (name: string): SAtom => ({ type: "symbol", name });
export const str = (value: string): SAtom => ({ type: "string", value });
export const num = (value: number): SAtom => ({ type: "number", value });

export function onlyForm(forms: readonly SExp[]): SExp {
  const form = forms[0];
  if (forms.length !== 1 || form === undefined)
    throw new Error(`Expected exactly one S-expression, found ${forms.length}`);
  return form;
}
