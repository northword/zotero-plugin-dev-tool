import { basename, join } from "node:path";
import { env } from "node:process";
import glob from "fast-glob";
import fs from "fs-extra";
import mime from "mime";
import { Octokit } from "octokit";
import { isCI } from "std-env";
import type { Context } from "../../types/index.js";
import { ReleaseBase } from "./base.js";

export default class GitHub extends ReleaseBase {
  isCI: boolean;
  client: Octokit;
  constructor(ctx: Context) {
    super(ctx);
    this.isCI = isCI;
    this.client = this.getClient();
  }

  /**
   * Runs release
   *
   * if is not CI，bump version, git add (package.json), git commit, git tag, git push;
   * if is CI, do not bump version, do not run git, create release (tag is `v${version}`) and upload xpi,
   *    then, create or update release (tag is "release"), update `update.json`.
   */
  async run() {
    const { dist } = this.ctx;

    if (glob.globSync(`${dist}/*.xpi`).length === 0) {
      throw new Error("No xpi file found, are you sure you have run build?");
    }
    this.logger.info("Uploading XPI...");
    await this.uploadXPI();
    this.logger.info("Uploading update manifest...");
    await this.refreshUpdateManifest();

    return this.ctx;
  }

  /**
   * Create new release and upload XPI to asset
   */
  async uploadXPI() {
    const { version, dist, xpiName } = this.ctx;

    // const releaseItConfig: ReleaseItConfig = {
    //   increment: false,
    //   git: { commit: false, tag: false, push: false },
    //   github: {
    //     release: true,
    //   },
    //   verbose: 2,
    //   ci: true,
    // };

    // releaseIt(_.defaultsDeep(releaseItConfig, this.config.release.releaseIt));

    const release = await this.createRelease({
      owner: this.owner,
      repo: this.repo,
      tag_name: this.ctx.release.bumpp
        .tag!.toString()
        .replaceAll("%s", version),
      name: `Release v${version}`,
      body: await this.getChangelog(),
      prerelease: version.includes("-"),
      make_latest: "true",
    });

    if (!release)
      throw new Error("Create release failed!");

    this.logger.debug("Uploading xpi asset...");

    await this.uploadAsset(release.id, join(dist, `${xpiName}.xpi`));
  }

  async getReleaseByTag(tag: string) {
    return await this.client.rest.repos
      .getReleaseByTag({
        owner: this.owner,
        repo: this.repo,
        tag,
      })
      .catch((e) => {
        this.logger.log(`Release with tag ${tag} not found. ${e}`);
        return undefined;
      })
      .then((res) => {
        if (res && res.status === 200) {
          return res.data;
        }
      });
  }

  async createRelease(
    options: Parameters<Octokit["rest"]["repos"]["createRelease"]>[0],
  ) {
    this.logger.debug("Creating release...", options);
    return await this.client.rest.repos
      .createRelease(options)
      .catch((e) => {
        this.logger.error(e);
        throw new Error("Create release failed.");
      })
      .then((res) => {
        if (res.status === 201) {
          return res.data;
        }
      });
  }

  async uploadAsset(releaseID: number, asset: string) {
    return await this.client.rest.repos
      .uploadReleaseAsset({
        owner: this.owner,
        repo: this.repo,
        release_id: releaseID,
        data: fs.readFileSync(asset) as unknown as string,
        headers: {
          "content-type": mime.getType(asset) || "application/octet-stream",
          "content-length": fs.statSync(asset).size,
        },
        name: basename(asset),
      })
      .then((res) => {
        return res.data;
      });
  }

  async refreshUpdateManifest() {
    const { dist, version } = this.ctx;

    const assets = glob.globSync(`${dist}/*.json`).map(p => basename(p));

    const release
      = (await this.getReleaseByTag("release"))
      ?? (await this.createRelease({
        owner: this.owner,
        repo: this.repo,
        tag_name: "release",
        prerelease: true,
        make_latest: "false",
      }));

    if (!release)
      throw new Error("Get or create 'release' failed.");

    const existAssets = await this.client.rest.repos
      .listReleaseAssets({
        owner: this.owner,
        repo: this.repo,
        release_id: release.id,
      })
      .then((res) => {
        return res.data.filter(asset => assets.includes(asset.name));
      });

    if (existAssets) {
      for (const existAsset of existAssets) {
        if (assets.includes(existAsset.name)) {
          await this.client.rest.repos.deleteReleaseAsset({
            owner: this.owner,
            repo: this.repo,
            asset_id: existAsset.id,
          });
        }
      }
    }

    for (const asset of assets) {
      await this.uploadAsset(release.id, join(dist, asset));
    }

    await this.client.rest.repos.updateRelease({
      owner: this.owner,
      repo: this.repo,
      release_id: release.id,
      name: "Release Manifest",
      body: `This release is used to host \`update.json\`, please do not delete or modify it! \n Updated in UTC ${new Date().toISOString()} for version ${version}`,
      prerelease: true,
      make_latest: "false",
    });
  }

  async getChangelog() {
    const { release } = this.ctx;
    const { github } = release;
    const { releaseNote } = github;
    return releaseNote(this.ctx);
  }

  getClient(): Octokit {
    if (!env.GITHUB_TOKEN)
      throw new Error("No GITHUB_TOKEN.");
    const client = new Octokit({
      auth: env.GITHUB_TOKEN,
      userAgent: "zotero-plugin-scaffold",
    });

    return client;
  }

  get owner(): string {
    return this.ctx.templateDate.owner;
  }

  get repo(): string {
    return this.ctx.templateDate.repo;
  }
}
