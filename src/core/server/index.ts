import type { Context } from "../../types/index.js";
import type { ServeBase } from "./base.js";
import process from "node:process";
import chokidar from "chokidar";
import { debounce } from "es-toolkit";
import { Base } from "../base.js";
import Build from "../builder.js";
import { killZotero } from "./kill-zotero.js";
import RunnerProxy from "./runner-proxy.js";
import RunnerTest from "./runner-test.js";
import RunnerWebExt from "./runner-web-ext.js";

export default class Serve extends Base {
  private builder: Build;
  private runner?: ServeBase;
  constructor(ctx: Context) {
    super(ctx);
    process.env.NODE_ENV ??= "development";
    this.builder = new Build(ctx);
  }

  async run() {
    // Handle interrupt signal (Ctrl+C) to gracefully terminate Zotero process
    // Must be placed at the top to prioritize registration of events to prevent web-ext interference
    process.on("SIGINT", this.exit);

    const isTest = process.env.NODE_ENV === "test";

    if (isTest) {
      this.runner = new RunnerTest(this.ctx);
    }
    else if (this.ctx.server.asProxy) {
      this.runner = new RunnerProxy(this.ctx);
    }
    else {
      this.runner = new RunnerWebExt(this.ctx);
    }

    await this.ctx.hooks.callHook("serve:init", this.ctx);

    // prebuild
    await this.builder.run();
    await this.ctx.hooks.callHook("serve:prebuild", this.ctx);

    // start Zotero
    await this.runner.run();

    // watch
    if (!isTest) {
      await this.watch();
    }
  }

  /**
   * watch source dir and build when file changed
   */
  async watch() {
    const { source } = this.ctx;

    const watcher = chokidar.watch(source, {
      ignored: /(^|[/\\])\../, // ignore dotfiles
      persistent: true,
    });

    const onChangeDebounced = debounce(async (path: string) => {
      await this.onChange(path).catch((err) => {
        // Do not abort the watcher when errors occur
        // in builds triggered by the watcher.
        this.logger.error(err);
      });
    }, 500);

    watcher
      .on("ready", async () => {
        await this.ctx.hooks.callHook("serve:ready", this.ctx);
        this.logger.clear();
        this.logger.ready("Server Ready!");
      })
      .on("change", async (path) => {
        this.logger.clear();
        this.logger.info(`${path} changed`);
        await onChangeDebounced(path);
      })
      .on("error", (err) => {
        this.logger.error("Server start failed!", err);
      });
  }

  async onChange(path: string) {
    await this.ctx.hooks.callHook("serve:onChanged", this.ctx, path);

    if (path.endsWith(".ts") || path.endsWith(".tsx")) {
      await this.builder.esbuild();
    }
    else {
      await this.builder.run();
    }

    await this.reload();
  }

  async reload() {
    this.logger.tip("Reloading...");
    await this.runner?.reload();
    await this.ctx.hooks.callHook("serve:onReloaded", this.ctx);
  }

  // Use arrow functions to keep `this`
  exit = () => {
    this.logger.info("Server shutdown by user request.");
    this.runner?.exit();
    // Sometimes `runner.exit()` cannot kill the Zotero,
    // so we force kill it.
    killZotero();
    this.ctx.hooks.callHook("serve:exit", this.ctx);
    process.exit();
  };
}
