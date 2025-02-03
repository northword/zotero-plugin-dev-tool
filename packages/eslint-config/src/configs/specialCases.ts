import type { Config } from "../types.js";

export const specialCases: Config[] = [
  {
    files: ["**/prefs.js"],
    name: "zotero-plugin/special/prefs",
    rules: {
      "no-undef": "off",
    },
  },
  {
    files: ["**/bootstrap.{js,ts}"],
    name: "zotero-plugin/special/bootstrap",
    rules: {
      "no-undef": "off",
    },
  },
];
