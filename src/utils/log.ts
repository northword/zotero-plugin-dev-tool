import chalk from "chalk";
import { isCI, isDebug } from "std-env";
import { isPlainObject } from "es-toolkit";
import type { Config, Context } from "../types/index.js";

/**
 * Log level
 */
enum LOG_LEVEL {
  trace = 0,
  debug = 1,
  info = 2,
  warn = 3,
  error = 4,
}

/**
 * Logger
 */
export class Log {
  private logLevel: number;
  constructor(config?: Config) {
    if (!config || isCI || isDebug) {
      this.logLevel = LOG_LEVEL.trace;
    }
    else {
      this.logLevel = LOG_LEVEL[config.logLevel];
    }
  }

  private formatArgs(arg: any): string {
    if (typeof arg === "string")
      return arg;

    if (arg instanceof Error) {
      return `${chalk.red(arg.name)}: ${chalk.red(arg.message)}\n${arg.stack}`;
    }

    if (typeof arg === "object" && arg !== null && isPlainObject(arg)) {
      return JSON.stringify(arg, null, 2);
    }

    return arg;
  }

  private logArgs(level: LOG_LEVEL, ...args: any[]) {
    if (this.logLevel > level)
      return;

    args = args.map(arg => this.formatArgs(arg));
    // eslint-disable-next-line no-console
    console.log(...args);
  }

  error(...args: any[]) {
    this.logArgs(LOG_LEVEL.error, chalk.red("ERROR"), ...args);
  }

  warn(...args: any[]) {
    this.logArgs(LOG_LEVEL.warn, chalk.yellow("WARNING"), ...args);
  }

  tip(...args: any[]) {
    this.logArgs(LOG_LEVEL.info, chalk.blue("TIP"), ...args);
  }

  info(...args: any[]) {
    this.logArgs(LOG_LEVEL.info, chalk.green("INFO"), ...args);
  }

  debug(...args: any[]) {
    this.logArgs(LOG_LEVEL.debug, chalk.grey("DEBUG"), ...args);
  }

  ready(...args: any[]) {
    this.logArgs(LOG_LEVEL.info, chalk.green("√", ...args));
  }

  success(...args: any[]) {
    this.logArgs(LOG_LEVEL.info, chalk.green("√"), ...args);
  }

  fail(...args: any[]) {
    this.logArgs(LOG_LEVEL.error, chalk.red("×"), ...args);
  }

  clear() {
    // eslint-disable-next-line no-console
    console.clear();
  }

  newLine() {
    // eslint-disable-next-line no-console
    console.log("");
  }
}

/**
 * Patch web-ext's logger with scaffold's logger.
 *
 * Modified from https://github.com/wxt-dev/wxt/blob/45809c0198af3da66efd3579f042ec81fdba6ff4/packages/wxt/src/core/runners/web-ext.ts#L26-L31
 */
export async function patchWebExtLogger(ctx: Context) {
  const { logger } = ctx;

  // https://github.com/mozilla/web-ext/blob/e37e60a2738478f512f1255c537133321f301771/src/util/logger.js#L12
  // const DEBUG_LOG_LEVEL = 20;
  const INFO_LOG_LEVEL = 30;
  const WARN_LOG_LEVEL = 40;
  const ERROR_LOG_LEVEL = 50;

  // Use the scaffold's logger instead of web-ext's built-in one.
  const webExtLogger = await import("web-ext/util/logger");
  webExtLogger.consoleStream.write = ({ level, msg, name }) => {
    if (level >= ERROR_LOG_LEVEL)
      logger.error(name, msg);
    if (level >= WARN_LOG_LEVEL)
      logger.warn(msg);
    if (level >= INFO_LOG_LEVEL)
    // Discard web-ext's debug log becaule web-ext's debug have firefox's stdout and stderr,
    // and set web-ext's info to scaffold' debug
      logger.debug(msg);
  };

  return webExtLogger;
}
