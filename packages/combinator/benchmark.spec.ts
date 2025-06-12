import { describe, it } from "bun:test";
import type { Parser } from "tpeg-core";
import { any, charClass, lit } from "tpeg-core";

const EMOJI = "😊";
const SURROGATE = "𝄞"; // U+1D11E
const ASCII = "a";
const LONG_UNICODE = "a😊b𝄞c";

const repeat = (str: string, n: number) => Array(n).fill(str).join("");

const N = 10000;

// Utility for running and timing a parser N times
function benchParser(
  name: string,
  parser: Parser<string>,
  input: string,
) {
  it(`benchmark: ${name} x${N}`, () => {
    const pos = { offset: 0, column: 0, line: 1 };
    console.time(name);
    for (let i = 0; i < N; ++i) {
      parser(input, pos);
    }
    console.timeEnd(name);
  });
}

describe("Benchmark: Unicode parsing performance", () => {
  benchParser("any(ASCII)", any, ASCII);
  benchParser("any(EMOJI)", any, EMOJI);
  benchParser("any(SURROGATE)", any, SURROGATE);
  benchParser("charClass(ASCII)", charClass(ASCII), ASCII);
  benchParser("charClass(EMOJI)", charClass(EMOJI), EMOJI);
  benchParser("charClass(SURROGATE)", charClass(SURROGATE), SURROGATE);
  benchParser("lit(ASCII)", lit(ASCII), ASCII);
  benchParser("lit(EMOJI)", lit(EMOJI), EMOJI);
  benchParser("lit(SURROGATE)", lit(SURROGATE), SURROGATE);
  benchParser("lit(LONG_UNICODE)", lit(LONG_UNICODE), LONG_UNICODE);
});
