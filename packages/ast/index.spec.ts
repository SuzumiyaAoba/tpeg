import { describe, expect, it } from "bun:test";

import {
  type Expr,
  id,
  not,
  any,
  choice,
  lit,
  def,
  seq,
  many,
  many1,
  map,
  charClass,
} from "./index";

const EOF = def("EOF", not(any()));

const Space = def("Space", charClass(" ", "\t"));

const _ = def("_", many(id("Space")));

const Digit = def("Digit", charClass(["0", "9"]));

// biome-ignore lint/suspicious/noShadowRestrictedNames:
const Number = def(
  "Number",
  map(many1(id("Digit")), ($) => $),
);

describe("ast", () => {
  it("", () => {
    console.log(JSON.stringify(EOF, null, 2));
    console.log(JSON.stringify(Space, null, 2));
    console.log(JSON.stringify(_, null, 2));
    console.log(JSON.stringify(Digit, null, 2));
    console.log(JSON.stringify(Number, null, 2));
  });
});
