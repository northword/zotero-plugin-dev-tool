import { ignores } from "./configs/ignores";
import { javascript } from "./configs/javascript";
import { specialCases } from "./configs/specialCases";
import { typescriptCore } from "./configs/typescript";

export function zotero() {
  return [
    ...ignores,
    ...javascript,
    ...typescriptCore,
    ...specialCases,
  ];
}
