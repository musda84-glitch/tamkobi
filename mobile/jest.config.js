/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  testMatch: ["**/src/**/*.test.ts"],
  transform: { "^.+\\.tsx?$": ["ts-jest", { tsconfig: { types: ["jest"] } }] },
  moduleFileExtensions: ["ts", "tsx", "js"],
};
