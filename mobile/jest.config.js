/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  testMatch: ["**/src/**/*.test.ts", "**/src/**/*.test.tsx"],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", {
      tsconfig: { types: ["jest"], jsx: "react-jsx" },
      // Screen modules already have tsc errors; Jest runs them, tsc --noEmit counts them.
      diagnostics: false,
    }],
  },
  moduleFileExtensions: ["ts", "tsx", "js"],
};
