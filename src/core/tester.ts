import type { Context } from "../types/index.js";
import http from "node:http";
import { join, resolve } from "node:path";
import process, { cwd } from "node:process";
import { build } from "esbuild";
import { copy, emptyDir, outputFile, outputJSON, pathExists } from "fs-extra/esm";
import { isCI } from "std-env";
import { glob } from "tinyglobby";
import { Xvfb } from "xvfb-ts";
import { saveResource } from "../utils/file.js";
import { installXvfb, installZoteroLinux } from "../utils/headless.js";
import { toArray } from "../utils/string.js";
import { ZoteroRunner } from "../utils/zotero-runner.js";
import { findFreeTcpPort } from "../utils/zotero/remote-zotero.js";
import { Base } from "./base.js";
import Build from "./builder.js";

export default class Test extends Base {
  private builder: Build;
  private runner?: ZoteroRunner;
  private communicator: { server?: http.Server; port?: number } = {};

  constructor(ctx: Context) {
    super(ctx);
    process.env.NODE_ENV ??= "test";

    this.builder = new Build(ctx);

    if (isCI) {
      this.ctx.test.exitOnFinish = true;
      this.ctx.test.headless = true;
    }
  }

  async run() {
    // Handle interrupt signal (Ctrl+C) to gracefully terminate Zotero process
    // Must be placed at the top to prioritize registration of events to prevent web-ext interference
    process.on("SIGINT", this.exit);

    // Empty dirs
    await emptyDir(this.profilePath);
    await emptyDir(this.dataDir);
    await emptyDir(this.testPluginDir);

    await this.ctx.hooks.callHook("test:init", this.ctx);

    // prebuild
    await this.builder.run();
    await this.ctx.hooks.callHook("test:prebuild", this.ctx);

    this.logger.clear();

    await this.startHttpServer();
    await this.ctx.hooks.callHook("test:listen", this.ctx);

    await this.createTestPlugin();
    await this.copyTestLibraries();
    await this.ctx.hooks.callHook("test:copyAssets", this.ctx);

    await this.bundleTests();
    await this.ctx.hooks.callHook("test:bundleTests", this.ctx);

    if (this.ctx.test.watch) {
      //
    }

    if ((isCI || this.ctx.test.headless)) {
      await this.startZoteroHeadless();
    }
    else {
      await this.startZotero();
    }

    await this.ctx.hooks.callHook("test:run", this.ctx);
  }

  async createTestPlugin() {
    const manifest = {
      manifest_version: 2,
      name: this.testPluginRef,
      version: "0.0.1",
      description: "Test suite for the Zotero plugin. This is a runtime-generated plugin only for testing purposes.",
      applications: {
        zotero: {
          id: this.testPluginID,
          update_url: "https://invalid.com",
          // strict_min_version: "*.*.*",
          strict_max_version: "999.*.*",
        },
      },
    };
    await outputJSON(`${this.testPluginDir}/manifest.json`, manifest, { spaces: 2 });

    const bootstrap = `
      /**
       * Code generated by the zotero-plugin-scaffold tester
       */
      
      var chromeHandle;
      
      function install(data, reason) {}
      
      async function startup({ id, version, resourceURI, rootURI }, reason) {
        await Zotero.initializationPromise;
        const aomStartup = Components.classes[
          "@mozilla.org/addons/addon-manager-startup;1"
        ].getService(Components.interfaces.amIAddonManagerStartup);
        const manifestURI = Services.io.newURI(rootURI + "manifest.json");
        chromeHandle = aomStartup.registerChrome(manifestURI, [
          ["content", "${this.testPluginRef}", rootURI + "content/"],
        ]);
      
        launchTests().catch((error) => {
          Zotero.debug(error);
          Zotero.HTTP.request(
            "POST",
            "http://localhost:${this.communicator.port}/update",
            {
              body: JSON.stringify({
                type: "fail",
                data: {
                  title: "Internal: Plugin awaiting timeout",
                  stack: "",
                  str: "Plugin awaiting timeout",
                },
              }),
            }
          );
        });
      }
      
      function onMainWindowLoad({ window: win }) {}
      
      function onMainWindowUnload({ window: win }) {}
      
      function shutdown({ id, version, resourceURI, rootURI }, reason) {
        if (reason === APP_SHUTDOWN) {
          return;
        }
      
        if (chromeHandle) {
          chromeHandle.destruct();
          chromeHandle = null;
        }
      }
      
      function uninstall(data, reason) {}
      
      async function launchTests() {
        // Delay to allow plugin to fully load before opening the test page
        await Zotero.Promise.delay(${this.ctx.test.startupDelay || 1000});
      
        const waitForPlugin = "${this.ctx.test.waitForPlugin}";
      
        if (waitForPlugin) {
          // Wait for a plugin to be installed
          await waitUtilAsync(() => {
            try {
              return !!eval(waitForPlugin)();
            } catch (error) {
              return false;
            }
          }).catch(() => {
            throw new Error("Plugin awaiting timeout");
          });
        }
      
        Services.ww.openWindow(
          null,
          "chrome://${this.testPluginRef}/content/index.xhtml",
          "${this.ctx.namespace}-test",
          "chrome,centerscreen,resizable=yes",
          {}
        );
      }
      
      function waitUtilAsync(condition, interval = 100, timeout = 1e4) {
        return new Promise((resolve, reject) => {
          const start = Date.now();
          const intervalId = setInterval(() => {
            if (condition()) {
              clearInterval(intervalId);
              resolve();
            } else if (Date.now() - start > timeout) {
              clearInterval(intervalId);
              reject();
            }
          }, interval);
        });
      }
      `.replaceAll(/^ {6}/g, "");
    await outputFile(`${this.testPluginDir}/bootstrap.js`, bootstrap);
  }

  async copyTestLibraries() {
    // Save mocha and chai packages
    const pkgs: {
      name: string;
      remote: string;
      local: string;
    }[] = [
      {
        name: "mocha.js",
        local: "node_modules/mocha/mocha.js",
        remote: "https://cdn.jsdelivr.net/npm/mocha/mocha.js",
      },
      {
        name: "chai.js",
        // local: "node_modules/chai/chai.js",
        local: "", // chai packages install from npm do not support browser
        remote: "https://www.chaijs.com/chai.js",
      },
    ];

    await Promise.all(pkgs.map(async (pkg) => {
      const targetPath = `${this.testPluginDir}/content/${pkg.name}`;

      if (pkg.local && await pathExists(pkg.local)) {
        this.logger.debug(`Local ${pkg.name} package found`);
        await copy(pkg.local, targetPath);
        return;
      }

      const cachePath = `${this.cacheDir}/${pkg.name}`;
      if (await pathExists(`${cachePath}`)) {
        this.logger.debug(`Cache ${pkg.name} package found`);
        await copy(cachePath, targetPath);
        return;
      }

      this.logger.info(`No local ${pkg.name} found, we recommend you install ${pkg.name} package locally.`);
      await saveResource(pkg.remote, `${this.cacheDir}/${pkg.name}`);
      await copy(cachePath, targetPath);
    }));
  }

  async bundleTests() {
    const testDirs = toArray(this.ctx.test.entries);

    // Bundle all test files, including both JavaScript and TypeScript
    for (const dir of testDirs) {
      let tsconfigPath: string | undefined = resolve(`${dir}/tsconfig.json`);
      if (!await pathExists(tsconfigPath)) {
        tsconfigPath = undefined;
      }

      await build({
        entryPoints: await glob(`${dir}/**/*.spec.{js,ts}`),
        outdir: `${this.testPluginDir}/content/units`,
        bundle: true,
        target: "firefox115",
        tsconfig: tsconfigPath || undefined,
      });
    }

    const testFiles = (await glob(`**/*.spec.js`, { cwd: `${this.testPluginDir}/content` })).sort();

    // Generate test farmwork code
    const setupCode = `
      mocha.setup({ ui: "bdd", reporter: Reporter, timeout: ${this.ctx.test.mocha.timeout} || 10000, });

      window.expect = chai.expect;
      window.assert = chai.assert;

      async function send(data) {
        console.log("Sending data to server", data);
        const req = await Zotero.HTTP.request(
          "POST",
          "http://localhost:${this.communicator.port}/update",
          {
            body: JSON.stringify(data),
          }
        );

        if (req.status !== 200) {
          dump("Error sending data to server" + req.responseText);
          return null;
        } else {
          const result = JSON.parse(req.responseText);
          return result;
        }
      }

      window.debug = function (...data) {
        const str = data.join("\\n");
        Zotero.debug(str);
        send({ type: "debug", data: { str } });
      };

      // Inherit the default test settings from Zotero
      function Reporter(runner) {
        var indents = 0,
          passed = 0,
          failed = 0,
          aborted = false;

        function indent() {
          return Array(indents).join("  ");
        }

        function dump(str) {
          console.log(str);
          document.querySelector("#mocha").innerText += str;
        }

        runner.on("start", async function () {
          await send({ type: "start" });
        });

        runner.on("suite", async function (suite) {
          ++indents;
          const str = indent() + suite.title + "\\n";
          dump(str);
          await send({ type: "suite", data: { title: suite.title, str } });
        });

        runner.on("suite end", async function (suite) {
          --indents;
          const str = indents === 1 ? "\\n" : "";
          dump(str);
          await send({ type: "suite end", data: { title: suite.title, str } });
        });

        runner.on("pending", async function (test) {
          const str = indent() + "pending  -" + test.title + "\\n";
          dump(str);
          await send({ type: "pending", data: { title: test.title, str } });
        });

        runner.on("pass", async function (test) {
          passed++;
          let str = indent() + Mocha.reporters.Base.symbols.ok + " " + test.title;
          if ("fast" != test.speed) {
            str += " (" + Math.round(test.duration) + " ms)";
          }
          str += "\\n";
          dump(str);
          await send({
            type: "pass",
            data: { title: test.title, duration: test.duration, str },
          });
        });

        runner.on("fail", async function (test, err) {
          // Make sure there's a blank line after all stack traces
          err.stack = err.stack.replace(/\\s*$/, "\\n\\n");

          failed++;
          let indentStr = indent();
          const str =
            indentStr +
            // Dark red X for errors
            "\\x1B[31;40m" +
            Mocha.reporters.Base.symbols.err +
            " [FAIL]\\x1B[0m" +
            // Trigger bell if interactive
            (Zotero.automatedTest ? "" : "\\x07") +
            " " +
            test.title +
            "\\n" +
            indentStr +
            "  " +
            err.message +
            " at\\n" +
            err.stack.replace(/^/gm, indentStr + "    ").trim() +
            "\\n\\n";
          dump(str);

          if (${this.ctx.test.abortOnFail ? "true" : "false"}) {
            aborted = true;
            runner.abort();
          }

          await send({
            type: "fail",
            data: { title: test.title, stack: err.stack, str },
          });
        });

        runner.on("end", async function () {
          const str =
            passed +
            "/" +
            (passed + failed) +
            " tests passed" +
            (aborted ? " -- aborting" : "") +
            "\\n";
          dump(str);

          await send({
            type: "end",
            data: { passed: passed, failed: failed, aborted: aborted, str },
          });

          // Must exit on Zotero side, otherwise the exit code will not be 0 and CI will fail
          if (${this.ctx.test.exitOnFinish ? "true" : "false"}) {
            Zotero.Utilities.Internal.quit(0);
          }
        });
      }
      `.replaceAll("  ", "    ");
    // await outputFile(`${this.testPluginDir}/content/setup.js`, setupCode);

    const html = `
      <!DOCTYPE html>
      <html lang="en" xmlns="http://www.w3.org/1999/xhtml">
      <head>
          <meta charset="UTF-8"></meta>
          <meta name="viewport" content="width=device-width, initial-scale=1.0"></meta>
          <title>Zotero Plugin Test</title>
          <style>
              html {
                  min-width: 400px;
                  min-height: 600px;
              }
              body {
                  font-family: Arial, sans-serif;
              }
          </style>
      </head>
      <body>
          <div id="mocha"></div>
      
          <!-- Include Zotero Vars -->
          <script src="chrome://zotero/content/include.js"></script>

          <!-- Mocha and Chai Libraries -->
          <script src="mocha.js"></script>
          <script src="chai.js"></script>

          <!-- Setup Mocha -->
          <script>
            ${setupCode}
          </script>

          <!-- Unit tests -->
          ${testFiles.map(f => `<script src="${f}"></script>\n    `)}

          <!-- Run Mocha -->
          <script class="mocha-exec">
            mocha.run();
          </script>
      </body>
      </html>
      `.replaceAll(/^ {6}/gm, "");
    await outputFile(`${this.testPluginDir}/content/index.xhtml`, html);

    // await outputFile(`${this.testPluginDir}/content/setup.js`, setupCode);

    this.logger.tip(`Injected ${testFiles.length} test files`);
  }

  async startHttpServer() {
    // Start a HTTP server to receive test results
    // This is useful for CI/CD environments
    this.communicator.server = http.createServer((req, res) => {
      if (req.method === "GET" && req.url === "/") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("Zotero Plugin Test Server is running");
      }
      else
        if (req.method === "POST" && req.url === "/update") {
          let body = "";

          // Collect data chunks
          req.on("data", (chunk) => {
            body += chunk;
          });

          // Parse and handle the complete data
          req.on("end", async () => {
            try {
              const jsonData = JSON.parse(body);
              await this.onHttpDataUpdated(jsonData);

              // Send a response to the client
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ message: "Results received successfully" }));
            }
            catch (error: any) {
              this.logger.error("Error parsing JSON:", error);
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Invalid JSON" }));
            }
          });
        }
        else {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Not Found" }));
        }
    });

    // Start the server
    const PORT = this.communicator.port = await findFreeTcpPort();
    this.communicator.server.listen(PORT, () => {
      this.logger.tip(`Server is listening on http://localhost:${PORT}`);
    });
  }

  async onHttpDataUpdated(body: {
    type: "start" | "suite" | "suite end" | "pending" | "pass" | "fail" | "end" | "debug";
    data?: { title: string; str: string; duration?: number; stack?: string };
  }) {
    if (body.type === "debug" && body.data?.str) {
      for (const line of body.data?.str.split("\n")) {
        this.logger.log(line);
        this.logger.newLine();
      }
    }
    const str = body.data?.str.replaceAll("\n", "");
    if (body.type === "start") {
      this.logger.newLine();
    }
    else if (body.type === "suite" && !!str) {
      this.logger.tip(str);
    }
    if (body.type === "pass" && !!str) {
      this.logger.log(str);
    }
    else if (body.type === "fail") {
      this.logger.error(str);
      if (this.ctx.test.abortOnFail) {
        this.logger.error("Aborting test run due to failure");
        if (this.ctx.test.exitOnFinish)
          this.exit(1);
      }
    }
    else if (body.type === "suite end") {
      this.logger.newLine();
    }
    else if (body.type === "end") {
      this.logger.success("Test run completed");
      this.communicator.server?.close();
      if (this.ctx.test.exitOnFinish)
        this.exit();
    }
  }

  async watch() {
    //
  }

  async onCodeChanged(_path: string) {
    //
  }

  async startZoteroHeadless() {
    // Ensure xvfb installing
    await installXvfb();

    // Download and Extract Zotero Beta Linux
    await installZoteroLinux();

    // Set Environment Variable for Zotero Bin Path
    process.env.ZOTERO_PLUGIN_ZOTERO_BIN_PATH = `${cwd()}/Zotero_linux-x86_64/zotero`;

    const xvfb = new Xvfb();
    await xvfb.start();
    await this.startZotero();
  }

  async startZotero() {
    this.runner = new ZoteroRunner({
      binaryPath: this.zoteroBinPath,
      profilePath: this.profilePath,
      dataDir: this.dataDir,
      plugins: [{
        id: this.ctx.id,
        sourceDir: join(this.ctx.dist, "addon"),
      }, {
        id: this.testPluginID,
        sourceDir: this.testPluginDir,
      }],
      devtools: this.ctx.server.devtools,
      binaryArgs: this.ctx.server.startArgs,
      customPrefs: this.prefs,
    });

    await this.runner.run();
  }

  private exit = (code?: string | number) => {
    this.communicator.server?.close();
    this.runner?.exit();

    this.ctx.hooks.callHook("test:exit", this.ctx);

    if (code === 1) {
      this.logger.error("Test run failed");
      process.exit(1);
    }
    else if (code === "SIGINT") {
      this.logger.info("Tester shutdown by user request");
      process.exit();
    }
    else {
      this.logger.success("Test run completed successfully");
      process.exit();
    }
  };

  private get zoteroBinPath() {
    if (!process.env.ZOTERO_PLUGIN_ZOTERO_BIN_PATH)
      throw new Error("No Zotero Found.");
    return process.env.ZOTERO_PLUGIN_ZOTERO_BIN_PATH;
  }

  private get profilePath() {
    return `.scaffold/test/profile`;
  }

  private get dataDir() {
    return `.scaffold/test/data`;
  }

  private get testPluginDir() {
    return `.scaffold/test/resource`;
  }

  private get cacheDir() {
    return `.scaffold/cache`;
  }

  private get testPluginRef() {
    return `${this.ctx.namespace}-test`;
  }

  private get testPluginID() {
    return `${this.testPluginRef}@only-for-testing.com`;
  }

  private get prefs() {
    const defaultPref = {
      "extensions.experiments.enabled": true,
      "extensions.autoDisableScopes": 0,
      // Enable remote-debugging
      "devtools.debugger.remote-enabled": true,
      "devtools.debugger.remote-websocket": true,
      "devtools.debugger.prompt-connection": false,
      // Inherit the default test settings from Zotero
      "app.update.enabled": false,
      "extensions.zotero.sync.server.compressData": false,
      "extensions.zotero.automaticScraperUpdates": false,
      "extensions.zotero.debug.log": 5,
      "extensions.zotero.debug.level": 5,
      "extensions.zotero.debug.time": 5,
      "extensions.zotero.firstRun.skipFirefoxProfileAccessCheck": true,
      "extensions.zotero.firstRunGuidance": false,
      "extensions.zotero.firstRun2": false,
      "extensions.zotero.reportTranslationFailure": false,
      "extensions.zotero.httpServer.enabled": true,
      "extensions.zotero.httpServer.port": 23124,
      "extensions.zotero.httpServer.localAPI.enabled": true,
      "extensions.zotero.backup.numBackups": 0,
      "extensions.zotero.sync.autoSync": false,
      "extensions.zoteroMacWordIntegration.installed": true,
      "extensions.zoteroMacWordIntegration.skipInstallation": true,
      "extensions.zoteroWinWordIntegration.skipInstallation": true,
      "extensions.zoteroOpenOfficeIntegration.skipInstallation": true,
    };

    return Object.assign(defaultPref, this.ctx.test.prefs || {});
  }
}
