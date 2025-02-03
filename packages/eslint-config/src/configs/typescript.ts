import type { Config } from "../types.js";
import tseslint from "typescript-eslint";
import { GLOB_TS, GLOB_TSX } from "../globs.js";

export const typescriptCore = tseslint.config({
  extends: [...tseslint.configs.recommended],
  files: [GLOB_TS, GLOB_TSX],
  name: "zotero-plugin/typescript",
  rules: {
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/no-unsafe-function-type": "off",

  },
}) as Config[];
