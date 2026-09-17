import { describe, expect, it } from "vite-plus/test";
import { dirnameOf, normalizeModulePath } from "./path-utils.js";

describe("normalizeModulePath", () => {
  it("collapses `.` segments and duplicate separators", () => {
    expect(normalizeModulePath("./a/./b.tpeg")).toBe("a/b.tpeg");
    expect(normalizeModulePath("a//b.tpeg")).toBe("a/b.tpeg");
  });

  it("resolves interior `..` segments", () => {
    expect(normalizeModulePath("a/b/../c.tpeg")).toBe("a/c.tpeg");
    expect(normalizeModulePath("/a/../b.tpeg")).toBe("/b.tpeg");
  });

  // Regression for #92: leading `..` on a RELATIVE path used to be
  // silently dropped (`segments.pop()` on an empty stack), so
  // `../foo.tpeg` normalized to `foo.tpeg` and a grammar importing the
  // parent directory's file matched a same-named file in the CWD.
  it("preserves leading `..` segments on relative paths", () => {
    expect(normalizeModulePath("../foo.tpeg")).toBe("../foo.tpeg");
    expect(normalizeModulePath("../../foo.tpeg")).toBe("../../foo.tpeg");
    expect(normalizeModulePath("x/../../foo.tpeg")).toBe("../foo.tpeg");
    expect(normalizeModulePath("../a/../b.tpeg")).toBe("../b.tpeg");
  });

  it("clamps `..` at the root on absolute paths", () => {
    expect(normalizeModulePath("/../../x.tpeg")).toBe("/x.tpeg");
    expect(normalizeModulePath("/..")).toBe("/");
  });

  it("keeps distinct relative paths distinct", () => {
    expect(normalizeModulePath("../foo.tpeg")).not.toBe(
      normalizeModulePath("foo.tpeg"),
    );
  });
});

describe("dirnameOf", () => {
  it("returns the directory portion", () => {
    expect(dirnameOf("/a/b.tpeg")).toBe("/a");
    expect(dirnameOf("a/b.tpeg")).toBe("a");
  });

  it("returns an empty string when there is no directory", () => {
    expect(dirnameOf("x.tpeg")).toBe("");
  });

  // Regression for #92: `lastIndexOf("/")` is 0 for a root-level file,
  // and `slice(0, 0)` produced `""` -- indistinguishable from "no
  // directory", so `./bar.tpeg` imported from `/foo.tpeg` resolved to
  // the relative `bar.tpeg` instead of `/bar.tpeg`.
  it('returns "/" for a root-level file', () => {
    expect(dirnameOf("/foo.tpeg")).toBe("/");
  });
});
