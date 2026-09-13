import globals from "globals";

export default [
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        // Wails runtime bindings
        runtime: "readonly"
      }
    },
    rules: {
      "no-undef": "error"
    }
  }
];
