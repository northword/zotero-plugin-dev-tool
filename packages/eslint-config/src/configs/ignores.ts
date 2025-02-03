import type { Linter } from "eslint";
import pluginIgnore from "eslint-config-flat-gitignore";
import { GLOB_EXCLUDE } from "../globs.js";

export const ignores: Linter.Config[] = [
  {
    name: "zotero-plugin/global-ignores",
    ignores: [...GLOB_EXCLUDE, "**/build/**", "**/.scaffold/**"],
  },
  {
    ...pluginIgnore({ strict: false }),
    name: "zotero-plugin/gitignore",
  },
];
