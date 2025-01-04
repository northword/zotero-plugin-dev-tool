import type { Context } from "../types/index.js";
import type { Manifest } from "../types/manifest.js";
import type { UpdateJSON } from "../types/update-json.js";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import process from "node:process";
import AdmZip from "adm-zip";
import chalk from "chalk";
import { toMerged } from "es-toolkit";
import { build as buildAsync } from "esbuild";
import { copy, emptyDir, move, outputFile, outputJSON, readJSON, writeJson } from "fs-extra/esm";
import { glob } from "tinyglobby";
import { generateHash } from "../utils/crypto.js";
import { dateFormat, replaceInFile, toArray } from "../utils/string.js";
import { Base } from "./base.js";
import { parsePrefs, renderDts } from "./builders/prefs.js";

export default class Build extends Base {
  private buildTime: string;
  private isPreRelease: boolean;
  constructor(ctx: Context) {
    super(ctx);
    process.env.NODE_ENV ??= "production";
    this.buildTime = "";
    this.isPreRelease = this.ctx.version.includes("-");
  }

  /**
   * Default build runner
   */
  async run() {
    const { dist, version } = this.ctx;

    const t = new Date();
    this.buildTime = dateFormat("YYYY-mm-dd HH:MM:SS", t);
    this.logger.info(
      `Building version ${chalk.blue(version)} to ${chalk.blue(dist)} at ${chalk.blue(this.buildTime)} in ${chalk.blue(process.env.NODE_ENV)} mode.`,
    );
    await this.ctx.hooks.callHook("build:init", this.ctx);

    await emptyDir(dist);
    await this.ctx.hooks.callHook("build:mkdir", this.ctx);

    this.logger.tip("Preparing static assets");
    await this.makeAssets();
    await this.ctx.hooks.callHook("build:copyAssets", this.ctx);

    this.logger.debug("Preparing manifest");
    await this.makeManifest();
    await this.ctx.hooks.callHook("build:makeManifest", this.ctx);

    this.logger.debug("Preparing locale files");
    await this.prepareLocaleFiles();
    await this.ctx.hooks.callHook("build:fluent", this.ctx);

    await this.preparePrefs();

    this.logger.tip("Bundling scripts");
    await this.esbuild();
    await this.ctx.hooks.callHook("build:bundle", this.ctx);

    /** ======== build resolved =========== */

    if (process.env.NODE_ENV === "production") {
      this.logger.tip("Packing plugin");
      await this.pack();
      await this.ctx.hooks.callHook("build:pack", this.ctx);

      await this.makeUpdateJson();
      await this.ctx.hooks.callHook("build:makeUpdateJSON", this.ctx);
    }

    await this.ctx.hooks.callHook("build:done", this.ctx);
    this.logger.success(
      `Build finished in ${(new Date().getTime() - t.getTime()) / 1000} s.`,
    );
  }

  /**
   * Copys files in `Config.build.assets` to `Config.dist`
   */
  async makeAssets() {
    const { source, dist, build } = this.ctx;
    const { assets, define } = build;

    // We should ignore node_modules/ by default, glob this folder will be very slow
    const paths = await glob(assets, { ignore: ["node_modules", ".git", dist] });
    const newPaths = paths.map(p => `${dist}/addon/${p.replace(new RegExp(toArray(source).join("|")), "")}`);

    // Copys files in `Config.build.assets` to `Config.dist`
    await Promise.all(paths.map(async (file, i) => {
      await copy(file, newPaths[i]);
      this.logger.debug(`Copy ${file} to ${newPaths[i]}`);
    }));

    // Replace all `placeholder.key` to `placeholder.value` for all files in `dist`
    const replaceMap = new Map(
      Object.keys(define).map(key => [
        new RegExp(`__${key}__`, "g"),
        define[key],
      ]),
    );
    this.logger.debug("replace map: ", replaceMap);
    await replaceInFile({
      files: newPaths,
      from: Array.from(replaceMap.keys()),
      to: Array.from(replaceMap.values()),
      isGlob: false,
    });
  }

  /**
   * Override user's manifest
   *
   */
  async makeManifest() {
    if (!this.ctx.build.makeManifest.enable)
      return;

    const { name, id, updateURL, dist, version } = this.ctx;

    const userData = await readJSON(
      `${dist}/addon/manifest.json`,
    ) as Manifest;
    const template: Manifest = {
      ...userData,
      ...((!userData.name && name) && { name }),
      ...(version && { version }),
      manifest_version: 2,
      applications: {
        // @ts-expect-error 此处不包含版本限制
        zotero: {
          id,
          update_url: updateURL,
        },
      },
    };

    const data: Manifest = toMerged(userData, template);
    this.logger.debug("manifest: ", JSON.stringify(data, null, 2));

    outputJSON(`${dist}/addon/manifest.json`, data, { spaces: 2 });
  }

  async prepareLocaleFiles() {
    const { dist, namespace, build } = this.ctx;

    // https://regex101.com/r/lQ9x5p/1
    // eslint-disable-next-line regexp/no-super-linear-backtracking
    const FTL_MESSAGE_PATTERN = /^(?<message>[a-z]\S*)( *= *)(?<pattern>.*)$/gim;
    const HTML_DATAI10NID_PATTERN = new RegExp(`(data-l10n-id)="((?!${namespace})\\S*)"`, "g");

    // Get locale names
    const localePaths = await glob(`${dist}/addon/locale/*`, { onlyDirectories: true });
    const localeNames = localePaths.map(locale => basename(locale));
    this.logger.debug("Locale names:", localeNames);

    const allMessages = new Set<string>();
    const messagesByLocale = new Map<string, Set<string>>();

    for (const localeName of localeNames) {
      // Prefix Fluent messages in each ftl, add message to set.
      const localeMessages = new Set<string>();
      const ftlPaths = await glob(`${dist}/addon/locale/${localeName}/**/*.ftl`);

      await Promise.all(ftlPaths.map(async (ftlPath: string) => {
        let ftlContent = await readFile(ftlPath, "utf-8");
        const matches = [...ftlContent.matchAll(FTL_MESSAGE_PATTERN)];

        for (const match of matches) {
          const message = match.groups?.message;
          if (message) {
            const namespacedMessage = `${namespace}-${message}`;
            localeMessages.add(message);
            allMessages.add(message);
            ftlContent = ftlContent.replace(message, namespacedMessage);
          }
        }

        // If prefixFluentMessages===true, we save the changed ftl file,
        // otherwise discard the changes
        if (build.fluent.prefixFluentMessages)
          await writeFile(ftlPath, ftlContent);

        // rename *.ftl to addonRef-*.ftl
        if (build.fluent.prefixLocaleFiles === true) {
          await move(ftlPath, `${dirname(ftlPath)}/${namespace}-${basename(ftlPath)}`);
          this.logger.debug(`Prefix filename: ${ftlPath}`);
        }
      }));

      messagesByLocale.set(localeName, localeMessages);
    }

    // Prefix Fluent messages in xhtml
    const messagesInHTML = new Set<string>();
    const htmlPaths = await glob([
      `${dist}/addon/**/*.xhtml`,
      `${dist}/addon/**/*.html`,
    ]);
    await Promise.all(htmlPaths.map(async (htmlPath) => {
      let htmlContent = await readFile(htmlPath, "utf-8");
      const matches = [...htmlContent.matchAll(HTML_DATAI10NID_PATTERN)];

      for (const match of matches) {
        const [matched, attrKey, attrVal] = match;

        if (!allMessages.has(attrVal)) {
          this.logger.debug(`HTML data-i10n-id ${attrVal} do not exist in any FTL message, skip to namespace`);
          continue;
        }

        messagesInHTML.add(attrVal);
        const namespacedAttr = `${namespace}-${attrVal}`;
        htmlContent = htmlContent.replace(matched, `${attrKey}="${namespacedAttr}"`);
      }

      if (build.fluent.prefixFluentMessages)
        await writeFile(htmlPath, htmlContent);
    }));

    // Check miss 1: Cross check in diff locale - seems no need
    // messagesMap.forEach((messageInThisLang, lang) => {
    //   // Needs Nodejs 22
    //   const diff = allMessages.difference(messageInThisLang);
    //   if (diff.size)
    //     this.logger.warn(`FTL messages "${Array.from(diff).join(", ")} don't exist the locale ${lang}"`);
    // });

    // Check miss 2: Check ids in HTML but not in ftl
    messagesInHTML.forEach((messageInHTML) => {
      const missingLocales = [...messagesByLocale.entries()]
        .filter(([_, messages]) => !messages.has(messageInHTML))
        .map(([locale]) => locale);

      if (missingLocales.length > 0) {
        this.logger.warn(`HTML data-l10n-id "${messageInHTML}" is missing in locales: ${missingLocales.join(", ")}`);
      }
    });
  }

  async preparePrefs() {
    if (!this.ctx.build.prefs.prefixPrefKeys && !this.ctx.build.prefs.dts)
      return;

    const prefsFilePath = join(this.ctx.dist, "addon", "prefs.js");
    if (!existsSync(prefsFilePath))
      return;

    const prefsContent = await readFile(prefsFilePath, "utf-8");
    const prefsMap = parsePrefs(prefsContent);

    if (this.ctx.build.prefs.prefixPrefKeys) {
      //
    }

    if (this.ctx.build.prefs.dts) {
      const dtsContent = renderDts(prefsMap, this.ctx.build.prefs.prefix);

      let dtsFilePath = `typings/prefs.d.ts`;
      if (typeof this.ctx.build.prefs.dts === "string")
        dtsFilePath = this.ctx.build.prefs.dts;

      await outputFile(dtsFilePath, dtsContent, "utf-8");
    }
  }

  esbuild() {
    const { build: { esbuildOptions } } = this.ctx;

    if (esbuildOptions.length === 0)
      return;

    return Promise.all(
      esbuildOptions.map(esbuildOption =>
        buildAsync(esbuildOption),
      ),
    );
  }

  async makeUpdateJson() {
    const { dist, xpiName, id, version, xpiDownloadLink, build } = this.ctx;

    const manifest = await readJSON(
      `${dist}/addon/manifest.json`,
    ) as Manifest;
    const min = manifest.applications?.zotero?.strict_min_version;
    const max = manifest.applications?.zotero?.strict_max_version;

    const updateHash = await generateHash(`${dist}/${xpiName}.xpi`, "sha512");

    const data: UpdateJSON = {
      addons: {
        [id]: {
          updates: [
            ...build.makeUpdateJson.updates,
            {
              version,
              update_link: xpiDownloadLink,
              ...(build.makeUpdateJson.hash && {
                update_hash: updateHash,
              }),
              applications: {
                zotero: {
                  strict_min_version: min,
                  ...(max && { strict_max_version: max }),
                },
              },
            },
          ],
        },
      },
    };

    await writeJson(`${dist}/update-beta.json`, data, { spaces: 2 });
    if (!this.isPreRelease)
      await writeJson(`${dist}/update.json`, data, { spaces: 2 });

    this.logger.debug(
      `Prepare Update.json for ${
        this.isPreRelease
          ? "\u001B[31m Prerelease \u001B[0m"
          : "\u001B[32m Release \u001B[0m"
      }`,
    );
  }

  async pack() {
    const { dist, xpiName } = this.ctx;
    const zip = new AdmZip();
    zip.addLocalFolder(`${dist}/addon`);
    zip.writeZip(`${dist}/${xpiName}.xpi`);
  }
}
