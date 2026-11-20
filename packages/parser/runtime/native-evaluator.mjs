// Keep this module separate from the bundle: evaluation must not inherit
// the loader's parameters, implicit arguments, or implementation bindings.
// Anonymous arrows also leave the native module's environment unnamed.
export default [
  () => globalThis,
  () => {
    "use strict";
    // A direct call gives grammar actions this strict, parameter-free lexical scope.
    // eslint-disable-next-line no-eval
    return eval(
      globalThis[
        Symbol.for("@suzumiyaaoba/tpeg-parser/native-evaluation-source")
      ],
    );
  },
];
