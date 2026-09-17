/**
 * Lexically normalizes a `/`-separated file path for equality
 * comparison: collapses `.` segments and duplicate separators, resolves
 * `..` segments, and preserves a leading `/`. No filesystem access --
 * registered `filePath`s and import `modulePath`s are compared as
 * strings only.
 *
 * `..` handling follows POSIX lexical normalization: on an ABSOLUTE path
 * a `..` past the root clamps to `/` (there is nothing above `/`), but
 * on a RELATIVE path a `..` with no preceding real segment is preserved
 * verbatim -- `../foo.tpeg` and `foo.tpeg` name different files and must
 * not collapse to the same normalized string.
 */
export const normalizeModulePath = (path: string): string => {
  const isAbsolute = path.startsWith("/");
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      const top = segments[segments.length - 1];
      if (top !== undefined && top !== "..") {
        segments.pop();
      } else if (!isAbsolute) {
        segments.push("..");
      }
      continue;
    }
    segments.push(segment);
  }
  return `${isAbsolute ? "/" : ""}${segments.join("/")}`;
};

/**
 * Directory portion of a `/`-separated path; `""` when it has none.
 * A root-level file (`/foo.tpeg`) returns `"/"`, not `""` -- `""` means
 * "no directory component", which would make `resolveRegisteredModuleName`
 * treat the file as importer-less and resolve `./bar.tpeg` to the
 * relative `bar.tpeg` instead of `/bar.tpeg`.
 */
export const dirnameOf = (path: string): string => {
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash === -1) {
    return "";
  }
  return lastSlash === 0 ? "/" : path.slice(0, lastSlash);
};
