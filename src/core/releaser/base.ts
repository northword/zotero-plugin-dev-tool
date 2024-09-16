import type { Context } from "../../types/index.js";
import { globbySync } from "globby";
import { isCI } from "std-env";
import { Base } from "../base.js";

export abstract class ReleaseBase extends Base {
  isCI: boolean;
  constructor(ctx: Context) {
    super(ctx);
    this.isCI = isCI;
  }

  abstract run(): Context | Promise<Context> | void | Promise<void>;

  checkFiles() {
    const { dist } = this.ctx;

    if (globbySync(`${dist}/*.xpi`).length === 0) {
      throw new Error("No xpi file found, are you sure you have run build?");
    }
  }

  abstract get remote(): { owner: string; repo: string };
}
