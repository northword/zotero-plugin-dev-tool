import type { Linter } from "eslint";
import pluginIgnore from "eslint-config-flat-gitignore";

export const ignores: Linter.Config[] = [
  {
    name: "zotero-plugin/global-ignores",
    ignores: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.scaffold/**"],
  },
  {
    ...pluginIgnore({ strict: false }),
    name: "sxzz/gitignore",
  },
];
