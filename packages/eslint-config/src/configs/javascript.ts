import type { Linter } from "eslint";
import eslintJs from "@eslint/js";

export const javascript: Linter.Config[] = [
  {
    name: "zotero-plugin/javascript",
    ...eslintJs.configs.recommended,
  },
];
