export default [
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: { window: "readonly", document: "readonly", localStorage: "readonly", navigator: "readonly", location: "readonly", console: "readonly", URL: "readonly", Blob: "readonly", Image: "readonly", setTimeout: "readonly", clearTimeout: "readonly", confirm: "readonly", structuredClone: "readonly", self: "readonly", caches: "readonly", fetch: "readonly", process: "readonly" } },
    rules: { "no-unused-vars": ["error", { args: "none" }], "no-undef": "error" },
  },
];
