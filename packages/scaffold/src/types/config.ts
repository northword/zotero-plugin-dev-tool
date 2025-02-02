import type { BuildOptions } from "esbuild";
import type { LogLevelType } from "../utils/log.js";
import type { Context } from "./index.js";
import type { Manifest } from "./manifest.js";
import type { UpdateJSON } from "./update-json.js";

export interface Config {
  /**
   * The source code directories.
   *
   * Can be multiple directories, and changes to these directories will be watched when `server` is running.
   *
   * 源码目录。
   *
   * 可以是多个目录，将在 `server` 运行时监听这些目录的变更。
   *
   * @default "src"
   */
  source: string | string[];
  /**
   * The build directories.
   *
   * Scaffold will store the code before packaging after the build at `${dist}/addon`.
   * Store the packaging results at `${dist}/${package_json.name}.xpi`.
   *
   * 构建目录。
   *
   * 脚手架将在 `${dist}/addon` 存放构建后打包前的代码。
   * 在 `${dist}/${xpiName}.xpi` 存放打包结果。
   *
   * @default "build"
   */
  dist: string;

  /**
   * The name of plugin.
   *
   * 插件名。
   *
   * @default package-json.name
   *
   */
  name: string;
  /**
   * The ID of plugin.
   *
   * Usually in the form of an email address or UUID.
   *
   * 插件 ID。
   *
   * 通常是邮箱地址或UUID的形式。
   *
   * @default package-json.name
   */
  id: string;
  /**
   * namespace of plugin.
   *
   * This attribute is also used to prevent plugin conflicts,
   * it may be used for plugin HTML element ids, preference prefixes,
   * fluent filename prefixes, fluent message prefixes, etc.
   *
   * Unlike the plugin id, this value should be HTML ID and Fluent Message compliant,
   * i.e.: contain at least one character and only letters and dashes.
   *
   * 插件命名空间。
   *
   * 这个属性也用于防止插件冲突，它可能被用于插件的 HTML 元素 id，
   * 首选项前缀，Fluent 文件名前缀、Fluent message 前缀等。
   *
   * 与插件 ID 不同的是，这个值应是符合 HTML ID 和 Fluent Message 规范的，
   * 即：至少包含一个字符，仅包含字母和短横线。
   *
   * @default kebabCase(name)
   */
  namespace: string;

  /**
   * XPI filename.
   *
   * XPI 文件名。
   *
   * @default kebabCase(name)
   */
  xpiName: string;
  /**
   * The download link of XPI.
   *
   * Some placeholders are available, see Context.templateData.
   *
   * XPI 文件的地址。
   *
   * 一些可用的占位符请参阅 Context.templateData。
   *
   * @default `https://github.com/{{owner}}/{{repo}}/release/download/v{{version}}/{{xpiName}}.xpi`
   *
   * @see {@link Context.templateData}
   */
  xpiDownloadLink: string;
  /**
   * The uri of update.json.
   *
   * Some placeholders are available, see Context.templateData.
   *
   * update.json 文件的地址。
   *
   * 一些可用的占位符请参阅 Context.templateData。
   *
   * @default `https://github.com/{{owner}}/{{repo}}/releaser/download/release/{{updateJson}}`
   *
   * @see {@link Context.templateData}
   */
  updateURL: string;

  /**
   * Configurations required to run the build.
   *
   * 构建所需的配置。
   */
  build: BuildConfig;

  /**
   * Configurations required to run the server.
   *
   * serve 所需的配置。
   */
  server: ServerConfig;

  /**
   * @todo Use addonLint package to lint XPI.
   */
  addonLint: object;

  /**
   * Configurations required to run the release.
   *
   * 发布相关配置。
   */
  release: ReleaseConfig;

  /**
   * Configurations required to run the test.
   *
   * 测试相关配置。
   *
   * Test is a variant of server, so it is not a separate hooks.
   */
  test: TestConfig;

  /**
   * Level of the log.
   *
   * 日志等级。
   *
   * @default "info"
   */
  logLevel: LogLevelType;
}

export interface BuildConfig {
  /**
   * The static assets.
   *
   * - Typically includes icons, ftl files, 3rd party JavaScript files, CSS files, XHTML files, etc.
   * - is an array of `glob` modes and supports negation modes.
   * - Do not add an entire directory unless it has no files to exclude.
   *
   * 静态资源文件。
   *
   * - 通常包括图标、ftl 文件、第三方 JavaScript 文件、CSS 文件、XHTML 文件等。
   * - 是一个 `glob` 模式数组，支持否定模式。
   * - 除非一个目录没有需要排除的文件，否则不要添加整个目录。
   *
   * @see {@link https://github.com/sindresorhus/globby?tab=readme-ov-file#globbing-patterns | Pattern syntax | 语法说明 }
   *
   * @example `["src/**\/*.*", "!src/**\/*.ts"]` (no `\`)
   *
   * @default "addon/**\/*.*" (no `\`)
   */
  assets: string | string[];
  /**
   * The placeholders to replace in static assets.
   *
   * - At build time, scaffolding uses the key of the placeholder to build the regular pattern `/__${key}__/g` and replaces matches with `value`.
   * - Replacement happens for all files under `assets`.
   *
   * 静态资源文本占位符。
   *
   * - 在构建时，脚手架使用占位符的 key 建立正则模式 `/__${key}__/g`，并将匹配到的内容替换为 `value`。
   * - 替换发生在 `assets` 下的所有文件。
   *
   * @see {@link Context.templateData}
   */
  define: {
    [key: string]: string;
  };
  fluent: {
    /**
     * Add plugin namespace prefixes to all FTL files to avoid conflicts.
     *
     * The default prefix is `${namespace}-`.
     *
     * 为所有 FTL 文件添加插件前缀以避免冲突。
     *
     * 默认前缀为 `${namespace}-`。
     *
     * @default true
     */
    prefixLocaleFiles: boolean;
    /**
     * Add plugin namespace prefixes to all FTL messages to avoid conflicts.
     *
     * The default prefix is `${namespace}-`.
     *
     * 为所有 FTL message 添加插件前缀以避免冲突。
     *
     * 默认前缀为 `${namespace}-`。
     *
     * @default true
     */
    prefixFluentMessages: boolean;

    dts: string | false;
  };
  prefs: {
    /**
     * Prefixes the keys of preferences in `prefs.js` and
     * the value of the `preference` attribute in XHTML files.
     *
     * 为 `prefs.js` 中的首选项键和 XHTML 文件中的 `preference` 属性的值
     * 添加前缀。
     *
     * @default true
     */
    prefixPrefKeys: boolean;
    /**
     * Prefixes for Preference Keys, no dot at the end.
     *
     * 首选项键的前缀，结尾不需要加点号。
     *
     * @default 'extensions.${namespace}'
     */
    prefix: string;
    /**
     * Generate prefs.d.ts form prefs.js.
     *
     * - false: disable
     * - string: path of dts file
     *
     * 为首选项生成类型声明文件。
     *
     * - false: 禁用
     * - string：dts 文件路径
     *
     * @default 'typings/prefs.d.ts'
     */
    dts: false | string;
  };
  /**
   * Configurations of esbuild.
   *
   * esbuild 配置。
   *
   * @default []
   *
   */
  esbuildOptions: BuildOptions[];
  /**
   * Make manifest.json.
   *
   */
  makeManifest: {
    /**
     * 是否自动管理 manifest.json。
     * 如果此项为 false，则开发者应自行准备 manifest.json。
     *
     * @default true
     */
    enable: boolean;
    /**
     * template of manifest.
     *
     * @deprecated
     *
     * @default
     *
     * ```json
     * {
     *   manifest_version: 2,
     *   name: "${name}",
     *   version: "${version}",
     *   applications: {
     *     zotero: {
     *       id: "${id}",
     *       update_url: "${updateURL}",
     *       strict_min_version: "6.999",
     *       strict_max_version: "7.0.*",
     *     },
     *     gecko: {
     *       id: "${id}",
     *       update_url: "${updateURL}",
     *       strict_min_version: "102",
     *     };
     *   };
     * };
     * ```
     */
    template: Manifest;
  };
  /**
   * Make update manifest.
   *
   * 生成 `update.json`。
   *
   */
  makeUpdateJson: {
    /**
     * Historical update data.
     *
     * This can be useful if you need to distribute different plugin versions
     * for different versions of Zotero.
     *
     * 已有的更新数据。
     *
     * 如果你需要为不同版本的 Zotero 分发不同的插件版本，这可能会很有用。
     *
     * @see {@link https://www.zotero.org/support/dev/zotero_7_for_developers#updaterdf_updatesjson | Zotero 7 for developers}
     * @see {@link https://extensionworkshop.com/documentation/manage/updating-your-extension/ | Updating your extension}
     * @see {@link https://zotero-chinese.com/plugin-dev-guide/reference/update | 更新清单 (In chinese)}
     *
     * @default []
     */
    updates: UpdateJSON["addons"][string]["updates"];
    /**
     * Whether or not to write the hash of the xpi file to update.json.
     *
     * 是否向 update.json 中写入 xpi 文件的 hash。
     *
     * @default true
     */
    hash: boolean;
  };
  /**
   * The lifecycle hooks.
   */
  hooks: Partial<BuildHooks>;
}

interface BuildHooks {
  "build:init": (ctx: Context) => void | Promise<void>;
  "build:mkdir": (ctx: Context) => void | Promise<void>;
  "build:copyAssets": (ctx: Context) => void | Promise<void>;
  "build:makeManifest": (ctx: Context) => void | Promise<void>;
  "build:fluent": (ctx: Context) => void | Promise<void>;
  "build:bundle": (ctx: Context) => void | Promise<void>;
  "build:pack": (ctx: Context) => void | Promise<void>;
  "build:makeUpdateJSON": (ctx: Context) => void | Promise<void>;
  "build:done": (ctx: Context) => void | Promise<void>;
}

export interface ServerConfig {
  /**
   * Open devtool on Zotero start.
   *
   * 在 Zotero 启动时打开 devtool。
   *
   * @default true
   */
  devtools: boolean;
  /**
   * Additional command line arguments when starting Zotero.
   *
   * 启动 Zotero 时附加的命令行参数。
   *
   * @default []
   */
  startArgs: string[];
  /**
   * Install the plugin as a Proxy File mode.
   *
   * 以 Proxy File 方式载入插件
   *
   * @default false
   */
  asProxy: boolean;

  prebuild: boolean;
  // keepProfileChanges: boolean;
  createProfileIfMissing: boolean;

  /**
   * The lifecycle hook.
   */
  hooks: Partial<ServeHooks>;
}

interface ServeHooks {
  "serve:init": (ctx: Context) => void | Promise<void>;
  "serve:prebuild": (ctx: Context) => void | Promise<void>;
  "serve:ready": (ctx: Context) => void | Promise<void>;
  "serve:onChanged": (ctx: Context, path: string) => void | Promise<void>;
  "serve:onReloaded": (ctx: Context) => void | Promise<void>;
  "serve:exit": (ctx: Context) => void;
}

export interface ReleaseConfig {
  /**
   * Configurations of bumpp
   *
   * bumpp 包的部分配置。
   */
  bumpp: {
    /**
     * The release version or type. Can be one of the following:
     *
     * - A release type (e.g. "major", "minor", "patch", "prerelease", etc.)
     * - "prompt" to prompt the user for the version number
     *
     * In general, it is recommended to set this to “prompt”.
     * If you need a command that always releases a certain type,
     * you can override this option on the command line.
     *
     * 发布的类型，可以是以下其中之一：
     *
     * - 版本类型（如 “major”、“minor”、“patch”、“prerelease”等）
     * - “prompt” 以选择版本号
     *
     * 通常来说，建议将此项设置为“prompt”。
     * 如果需要一个始终发布某类型的命令，可以在命令行中覆盖该选项。
     *
     * @default "prompt"
     */
    release: string;
    /**
     * The prerelease type (e.g. "alpha", "beta", "next").
     *
     * 预发布的类型，如 alpha，beta，next 等。
     *
     * @default "beta"
     */
    preid: string;
    /**
     * The commit message.
     *
     * Any `%s` placeholders in the message string will be replaced with the new version number.
     * If the message string does _not_ contain any `%s` placeholders,
     * then the new version number will be appended to the message.
     *
     * 提交说明模板。
     *
     * 模板中的 `%s` 占位符将被替换为新版本号。
     * 如果模板中不包含任何 `%s` 占位符，则新版本号将附加到模板末端。
     *
     * @default "chore(publish): release %s"
     */
    commit: string;
    /**
     * The tag template.
     *
     * Any `%s` placeholders in the tag string will be replaced with the new version number.
     * If the tag string does _not_ contain any `%s` placeholders,
     * then the new version number will be appended to the tag.
     *
     * 标签模板。
     *
     * 模板中的 `%s` 占位符将被替换为新版本号。
     * 如果模板中不包含任何 `%s` 占位符，则新版本号将附加到模板末端。
     *
     * @default "v%s"
     */
    tag: string;
    /**
     * Indicates whether the git commit should include ALL files (`git commit --all`)
     * rather than just the files that were modified by `versionBump()`.
     *
     * 表示 git 提交是否应包括所有文件（`git commit --all`)，
     * 而不是只包含被 `versionBump()` 修改过的文件。
     *
     * @default false
     *
     */
    all: boolean;
    /**
     * Prompt for confirmation.
     *
     * 选择版本号后是否要求二次确认。
     *
     * @default true
     */
    confirm: boolean;
    /**
     * Indicates whether to bypass git commit hooks (`git commit --no-verify`).
     *
     * 表示是否绕过 git commit hooks（`git commit --no-verify` ）。
     *
     * @default false
     */
    noVerify: boolean;
    /**
     * Excute additional command after bumping and before commiting.
     *
     * 在提升版本号之后，提交之前运行的额外命令。
     *
     * @default "npm run build"
     *
     */
    execute: string;
  };

  /**
   * Changelog.
   *
   * - "conventional-changelog": use conventional-changelog with angular preset,
   *    you must install "conventional-changelog" as an peer dependency.
   * - string: a command line with changelog output to stdout.
   *
   * 变更日志。
   *
   * - "conventional-changelog": 使用约定式变更日志，使用 angular 预设，
   *   你需要手动安装 conventional-changelog 作为依赖项。
   * - string: 命令行，变更日志输出到 stdout
   *
   * @default "git log {{previousTag}}..{{currentTag}}"
   */
  changelog: "conventional-changelog" | string | ((ctx: Context) => string);

  /**
   * Release to GitHub.
   */
  github: {
    /**
     * Enable release to GitHub.
     *
     * Include uploading XPI asset to GitHub release and all following steps.
     *
     * - "ci" to only enable in ci
     * - "local" to only enable in non-ci
     * - "always" to always enable
     * - "false" to always disable
     *
     * @default "ci"
     */
    enable: "ci" | "local" | "always" | "false";
    /**
     * The information of remote repository.
     *
     * Will be extracted from the `repository` property in `package.json` by default.
     *
     * @default {{owner}}/{{repo}}
     * @see {@link Context.templateData}
     */
    repository: string;
    /**
     * Upload update.json to release.
     *
     * This is the tagName of the release when the value is a string.
     *
     * 将 update.json 上传到指定的 GitHub release。
     *
     * 当值为字符串时，其为 release 的tagName。
     *
     * @default "release"
     */
    updater: string | false;
    /**
     * Comment to issues and prs inlcuded in release.
     *
     * @todo Not implemented yet
     *
     * @default false
     */
    comment: boolean;
    releaseNote: (ctx: Context) => string;
  };

  hooks: Partial<ReleaseHooks>;
};

interface ReleaseHooks {
  "release:init": (ctx: Context) => void | Promise<void>;
  // "release:version": (ctx: Context) => void | Promise<void>;
  "release:push": (ctx: Context) => void | Promise<void>;
  // "release:handleRelease": (ctx: Context) => void | Promise<void>;
  // "release:handleUpdater": (ctx: Context) => void | Promise<void>;
  "release:done": (ctx: Context) => void | Promise<void>;
}

export interface TestConfig {
  /**
   * The test source code directories, starting from the root directory of the project.
   * All `*.spec.js` files in these directories will be executed.
   * The files will be sorted by alphabetical order.
   *
   * 测试源码目录，从项目的根目录开始。
   * 这些目录中的所有 `*.spec.js` 文件将被执行。
   * 文件将按字母顺序排序。
   *
   * @default "test"
   */
  entries: string | string[];

  /**
   * The default preferences for the test.
   * These preferences will be set before the test starts.
   *
   * 测试的默认首选项。
   * 这些首选项将在测试开始前设置。
   */
  prefs: Record<string, string | boolean | number>;

  mocha: {
    /**
     * The timeout of the test.
     *
     * 测试的超时时间。
     *
     * @default 10000
     */
    timeout: number;
  };

  /**
   * Abort the test when the first test fails.
   *
   * 当第一个测试失败时中止测试。
   *
   * @default false
   */
  abortOnFail: boolean;

  /**
   * Exit Zotero when the test is finished.
   *
   * 测试完成后退出 Zotero。
   *
   * @default false
   */
  exitOnFinish: boolean;

  /**
   * Run Zotero in deadless mode.
   *
   * - Supported for Linux only.
   * - Default to true when in CI environments.
   *
   * 使用无头模式运行 Zotero。
   *
   * - 仅支持 Linux
   * - 在 CI 模式下，默认为 true
   *
   * @default false
   */
  headless: boolean;

  /**
   * The delay time before running the test. Make sure the plugin is fully loaded before running the test.
   *
   * 运行测试前的延迟时间。确保插件在运行测试前完全加载。
   *
   * @default 1000
   */
  startupDelay: number;

  /**
   * Function string that returns the initialization status of the plugin.
   *
   * If set, the test will wait until the function returns true before running the test.
   *
   * 返回插件初始化状态的函数字符串。
   *
   * 如果设置，测试将等待函数返回 true 后再运行测试。
   *
   * @default "() => true"
   *
   * @example
   * ```js
   * () => !!Zotero.BetterNotes.data.initialized
   * ```
   */
  waitForPlugin: string;

  /**
   * @todo not
   */
  watch: boolean;

  hooks: Partial<TestHooks>;
}

interface TestHooks {
  "test:init": (ctx: Context) => void | Promise<void>;
  "test:prebuild": (ctx: Context) => void | Promise<void>;
  "test:listen": (ctx: Context) => void | Promise<void>;
  "test:copyAssets": (ctx: Context) => void | Promise<void>;
  "test:bundleTests": (ctx: Context) => void | Promise<void>;
  "test:run": (ctx: Context) => void | Promise<void>;
  "test:exit": (ctx: Context) => void;
}

export interface Hooks extends BuildHooks, ServeHooks, ReleaseHooks, TestHooks {}
