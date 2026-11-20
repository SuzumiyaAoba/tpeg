type MethodFixture = {
  readonly name: string;
  readonly label: "get" | "set" | "async";
  readonly body: string;
};
export const objectMethodModifierFixtures: readonly MethodFixture[];
export const objectMethodReferenceFixtures: readonly MethodFixture[];
