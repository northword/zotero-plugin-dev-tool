import { basename, join } from "node:path";
import { env } from "node:process";
import { globbySync } from "globby";
import fs from "fs-extra";
import mime from "mime";
import { Octokit } from "octokit";
import type { Context } from "../../types/index.js";
import { ReleaseBase } from "./base.js";

export default class GitHub extends ReleaseBase {
  client: Octokit;
  constructor(ctx: Context) {
    super(ctx);
    this.client = this.getClient();
  }

  async run() {
    this.checkFiles();

    this.logger.info("Uploading XPI to GitHub...");
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
        this.logger.debug(`Release with tag ${tag} not found. ${e}`);
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
    this.logger.debug(`Uploading ${asset} to release ${releaseID}`);
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
    const updater = this.ctx.release.github.updater;
    if (!updater) {
      this.logger.debug(`Skip refresh update.json because release.github.updater = false`);
      return;
    }

    const { dist, version } = this.ctx;
    this.logger.info(`Uploading update.json to ${updater}...`);

    const assets = globbySync(`${dist}/update*.json`)
      .map(p => basename(p));

    const release
      = (await this.getReleaseByTag(updater))
      ?? (await this.createRelease({
        owner: this.owner,
        repo: this.repo,
        tag_name: updater,
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
          this.logger.debug(`Delete existed asset ${existAsset} in release ${updater}`);
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
}
