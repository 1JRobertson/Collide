import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    files: ["src/**/*.js"],
    languageOptions: {
      sourceType: "module",
      globals: {
        document: "readonly",
        window: "readonly",
        console: "readonly",
        URL: "readonly",
        Blob: "readonly",
        setTimeout: "readonly",
        fetch: "readonly",
        AbortController: "readonly"
      }
    },
    rules: {
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "prefer-const": "error",
      "no-var": "error"
    }
  }
];
