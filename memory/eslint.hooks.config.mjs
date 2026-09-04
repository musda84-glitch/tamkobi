import reactHooks from "/app/frontend/node_modules/eslint-plugin-react-hooks/index.js";
export default [{ files: ["**/*.jsx","**/*.js"], plugins: { "react-hooks": reactHooks }, languageOptions: { ecmaVersion: 2022, sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } }, rules: { "react-hooks/exhaustive-deps": "warn", "react-hooks/rules-of-hooks": "error" } }];
