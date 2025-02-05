import { ignores } from "./configs/ignores.js";
import { javascript } from "./configs/javascript.js";
import { specialCases } from "./configs/specialCases.js";
import { typescriptCore } from "./configs/typescript.js";

export function zotero() {
  return [
    ...ignores,
    ...javascript,
    ...typescriptCore,
    ...specialCases,
  ];
}
