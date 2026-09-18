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

/**
 * The module name a `/`-separated path refers to: its basename minus the
 * `.tpeg` extension (`"grammars/math.tpeg"` -> `"math"`, `"base.tpeg"`
 * -> `"base"`). `"unknown"` for a path with no usable final segment, so
 * callers comparing names can't confuse it with a real module name
 * (identifiers can't contain `/` or end in `.tpeg`).
 *
 * Shared by `NamespaceManager`/`VersionedModuleRegistry` (the default
 * registration key when no explicit `@namespace` is given) and
 * `ModuleResolver` (the default `import` alias when no `as` clause is
 * given) -- the three must agree or an import resolves under a different
 * name than the module registered itself as.
 */
export const moduleNameFromPath = (modulePath: string): string => {
  const parts = modulePath.split("/");
  const filename = parts[parts.length - 1];
  // `filename.replace` alone can still yield "" -- a final segment that is
  // nothing but the extension (`".tpeg"`, `"dir/.tpeg"`) strips down to an
  // empty string, which is no more usable a module name than a missing
  // segment: it would register/alias the module under "", which no
  // `Module.rule` reference (identifiers are non-empty) can ever name.
  const name = filename ? filename.replace(/\.tpeg$/, "") : "";
  return name || "unknown";
};
