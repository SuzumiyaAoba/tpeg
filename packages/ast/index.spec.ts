import { describe, expect, it } from "bun:test";

import {
  not,
  any,
  choice,
  lit,
  def,
  seq,
  many,
} from "./index";

const EndOfFile = def("EndOfFile", not(any()));

const EndOfLine = choice(lit("\r\n"), lit("\n"), lit("\r"));

const Space = choice(lit(" "), lit("\r"), EndOfLine);

const Comment = seq(lit("#"), many(seq(not(EndOfLine), any())));

describe("ast", () => {

  it("", () => {
    console.log(JSON.stringify(EndOfFile, null, 2));
    console.log(JSON.stringify(EndOfLine, null, 2));
    console.log(JSON.stringify(Space, null, 2));
    console.log(JSON.stringify(Comment, null, 2));
  });
});
