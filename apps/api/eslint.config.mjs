// @ts-check
import eslint from "@eslint/js"
import { defineConfig, globalIgnores } from "eslint/config"
import globals from "globals"
import tseslint from "typescript-eslint"

export default defineConfig([
  globalIgnores(["dist/**", "drizzle/**", "renderer/**", "eslint.config.mjs"]),
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      sourceType: "commonjs",
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Domänenschicht aus VibeShorts: ohne typgestützte Regeln, wie bisher unter eslint-config-next.
    files: ["src/core/**/*.ts"],
    extends: [tseslint.configs.disableTypeChecked],
    rules: { "no-useless-assignment": "off" },
  },
])
