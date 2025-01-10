import type { Linter } from "eslint";
import type { Rules } from "./typegen";

export type Config = Linter.Config<Linter.RulesRecord & Rules>;
