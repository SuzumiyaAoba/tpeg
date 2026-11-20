/** Shared action templates for scanner and generator tests. */
export const objectMethodModifierFixtures = [
  {
    name: "get identifier",
    label: "get",
    body: 'return { get value() { return "__VALUE__"; } }["value"];',
  },
  {
    name: "get computed",
    label: "get",
    body: 'return { get ["value"]() { return "__VALUE__"; } }["value"];',
  },
  {
    name: "get string",
    label: "get",
    body: 'return { get "value"() { return "__VALUE__"; } }["value"];',
  },
  {
    name: "get integer",
    label: "get",
    body: 'return { get 1() { return "__VALUE__"; } }[1];',
  },
  {
    name: "get decimal",
    label: "get",
    body: 'return { get .5() { return "__VALUE__"; } }[0.5];',
  },
  {
    name: "get astral",
    label: "get",
    body: 'return { get 𝒜() { return "__VALUE__"; } }["𝒜"];',
  },
  {
    name: "get escaped",
    label: "get",
    body: 'return { get v\\u0061lue() { return "__VALUE__"; } }["value"];',
  },
  {
    name: "get own name",
    label: "get",
    body: 'return { get get() { return "__VALUE__"; } }["get"];',
  },
  {
    name: "get comment",
    label: "get",
    body: 'return { get /* comment */ value() { return "__VALUE__"; } }["value"];',
  },
  {
    name: "set identifier",
    label: "set",
    body: 'let output=""; const object={get value(){return "";}, set value(input__TYPE__){output=input;}}; object["value"]="__VALUE__"; return output;',
  },
  {
    name: "set computed",
    label: "set",
    body: 'let output=""; const object={get ["value"](){return "";}, set ["value"](input__TYPE__){output=input;}}; object["value"]="__VALUE__"; return output;',
  },
  {
    name: "set string",
    label: "set",
    body: 'let output=""; const object={get "value"(){return "";}, set "value"(input__TYPE__){output=input;}}; object["value"]="__VALUE__"; return output;',
  },
  {
    name: "set integer",
    label: "set",
    body: 'let output=""; const object={get 1(){return "";}, set 1(input__TYPE__){output=input;}}; object[1]="__VALUE__"; return output;',
  },
  {
    name: "set decimal",
    label: "set",
    body: 'let output=""; const object={get .5(){return "";}, set .5(input__TYPE__){output=input;}}; object[0.5]="__VALUE__"; return output;',
  },
  {
    name: "set astral",
    label: "set",
    body: 'let output=""; const object={get 𝒜(){return "";}, set 𝒜(input__TYPE__){output=input;}}; object["𝒜"]="__VALUE__"; return output;',
  },
  {
    name: "set escaped",
    label: "set",
    body: 'let output=""; const object={get v\\u0061lue(){return "";}, set v\\u0061lue(input__TYPE__){output=input;}}; object["value"]="__VALUE__"; return output;',
  },
  {
    name: "set own name",
    label: "set",
    body: 'let output=""; const object={get set(){return "";}, set set(input__TYPE__){output=input;}}; object["set"]="__VALUE__"; return output;',
  },
  {
    name: "set comment",
    label: "set",
    body: 'let output=""; const object={get /* comment */ value(){return "";}, set /* comment */ value(input__TYPE__){output=input;}}; object["value"]="__VALUE__"; return output;',
  },
  {
    name: "async identifier",
    label: "async",
    body: 'const object={async value(){return "__VALUE__";}}; void object["value"]; return "__VALUE__";',
  },
  {
    name: "async computed",
    label: "async",
    body: 'const object={async ["value"](){return "__VALUE__";}}; void object["value"]; return "__VALUE__";',
  },
  {
    name: "async string",
    label: "async",
    body: 'const object={async "value"(){return "__VALUE__";}}; void object["value"]; return "__VALUE__";',
  },
  {
    name: "async integer",
    label: "async",
    body: 'const object={async 1(){return "__VALUE__";}}; void object[1]; return "__VALUE__";',
  },
  {
    name: "async decimal",
    label: "async",
    body: 'const object={async .5(){return "__VALUE__";}}; void object[0.5]; return "__VALUE__";',
  },
  {
    name: "async astral",
    label: "async",
    body: 'const object={async 𝒜(){return "__VALUE__";}}; void object["𝒜"]; return "__VALUE__";',
  },
  {
    name: "async escaped",
    label: "async",
    body: 'const object={async v\\u0061lue(){return "__VALUE__";}}; void object["value"]; return "__VALUE__";',
  },
  {
    name: "async own name",
    label: "async",
    body: 'const object={async async(){return "__VALUE__";}}; void object["async"]; return "__VALUE__";',
  },
  {
    name: "async comment",
    label: "async",
    body: 'const object={async /* comment */ value(){return "__VALUE__";}}; void object["value"]; return "__VALUE__";',
  },
  {
    name: "async generator",
    label: "async",
    body: 'const object={async *value(){yield "__VALUE__";}}; void object.value; return "__VALUE__";',
  },
  {
    name: "async computed generator",
    label: "async",
    body: 'const object={async /* comment */ *["value"](){yield "__VALUE__";}}; void object.value; return "__VALUE__";',
  },
];

export const objectMethodReferenceFixtures = [
  {
    name: "get shorthand",
    label: "get",
    body: "return { get }.get__JOIN__;",
  },
  {
    name: "get escaped shorthand",
    label: "get",
    body: "return { g\\u0065t }.get__JOIN__;",
  },
  {
    name: "get computed key",
    label: "get",
    body: 'return { get [get]() { return "__VALUE__"; } }[get];',
  },
  {
    name: "get body reference",
    label: "get",
    body: "return { get value() { return get__JOIN__; } }.value;",
  },
  {
    name: "set shorthand",
    label: "set",
    body: "return { set }.set__JOIN__;",
  },
  {
    name: "set escaped shorthand",
    label: "set",
    body: "return { s\\u0065t }.set__JOIN__;",
  },
  {
    name: "set computed key",
    label: "set",
    body: 'let output=""; const object={get [set](){return "";},set [set](input__TYPE__){output=input;}}; object[set]="__VALUE__"; return output;',
  },
  {
    name: "set body reference",
    label: "set",
    body: 'let output=""; const object={get value(){return "";},set value(input__TYPE__){void input; output=set__JOIN__;}}; object.value=""; return output;',
  },
  {
    name: "async shorthand",
    label: "async",
    body: "return { async }.async__JOIN__;",
  },
  {
    name: "async escaped shorthand",
    label: "async",
    body: "return { \\u0061sync }.async__JOIN__;",
  },
  {
    name: "async computed key",
    label: "async",
    body: 'const object={async [async](){return "__VALUE__";}}; void object[async]; return async__JOIN__;',
  },
  {
    name: "async body reference",
    label: "async",
    body: 'const object={async value(){return async__JOIN__;}}; void object.value; return "__VALUE__";',
  },
];
