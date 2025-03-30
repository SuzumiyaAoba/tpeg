export const octalDigitsToChar = (str: string): string => {
  return String.fromCharCode(Number.parseInt(str, 8));
};
