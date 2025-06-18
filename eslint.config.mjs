import eslintPluginImport from "eslint-plugin-import";
import eslintPluginReactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

/** @type {import('eslint').Linter.Config[]} */
export default [
  { files: ["**/*.{js,mjs,cjs,ts,jsx,tsx}"] },
  { languageOptions: { globals: globals.browser } },
  tseslint.configs.base,
  {
    rules: {
      eqeqeq: ["error", "always"],
    },
  },
  {
    // TODO: Simplify when https://github.com/facebook/react/issues/28313 is resolved
    plugins: {
      "react-hooks": eslintPluginReactHooks,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
  {
    plugins: {
      import: eslintPluginImport,
    },
    rules: {
      "import/extensions": [
        "error",
        "ignorePackages",
        {
          js: "always",
          ts: "never",
        },
      ],
    },
    settings: {
      "import/resolver": {
        node: {
          extensions: [".js"],
        },
      },
    },
  },
];
