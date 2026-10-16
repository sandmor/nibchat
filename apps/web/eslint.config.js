import { nextJsConfig } from "@workspace/eslint-config/next-js"

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...nextJsConfig,
  {
    files: ["scripts/**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        module: "readonly",
        require: "readonly",
        exports: "writable",
      },
    },
  },
  {
    files: ["components/workspace/transcript-viewport-model.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "react",
                "react/*",
                "react-dom",
                "react-dom/*",
                "next",
                "next/*",
                "@tanstack/*",
                "@/components/**",
                "./use-*",
                "./transcript-navigation",
                "./long-block-scroll",
              ],
              message:
                "Viewport policy must stay pure; normalize browser facts in the adapter.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        "window",
        "document",
        "globalThis",
        "requestAnimationFrame",
        "queueMicrotask",
        "ResizeObserver",
        "setTimeout",
        "setInterval",
        "HTMLElement",
        "Element",
        "fetch",
        "performance",
        "navigator",
        "localStorage",
        "sessionStorage",
        "matchMedia",
        "MutationObserver",
        "IntersectionObserver",
      ],
    },
  },
  {
    ignores: [".next/**", "playwright-report/**", "test-results/**"],
  },
]
