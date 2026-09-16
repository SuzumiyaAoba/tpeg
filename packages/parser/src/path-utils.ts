/**
 * Lexically normalizes a `/`-separated file path for equality
 * comparison: collapses `.` segments and duplicate separators, resolves
 * `..` segments, and preserves a leading `/`. No filesystem access --
 * registered `filePath`s and import `modulePath`s are compared as
 * strings only.
 */
export const normalizeModulePath = (path: string): string => {
  const isAbsolute = path.startsWith("/");
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `${isAbsolute ? "/" : ""}${segments.join("/")}`;
};

/** Directory portion of a `/`-separated path; `""` when it has none. */
export const dirnameOf = (path: string): string => {
  const lastSlash = path.lastIndexOf("/");
  return lastSlash === -1 ? "" : path.slice(0, lastSlash);
};
