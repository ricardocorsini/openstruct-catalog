import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { publicRaw, packageMessage, signBytes } from "../security.mjs";
import { authorizeSource, productReleaseTag } from "./source.mjs";
import { assembleCatalog, seal, verifyRelease } from "./release-lib.mjs";

const config = JSON.parse(
  await readFile(new URL("../../distribution.json", import.meta.url), "utf8"),
);
const base = JSON.parse(
  await readFile(
    new URL("../../catalog/bundled.json", import.meta.url),
    "utf8",
  ),
);
const product = config.products.find((item) => item.id === "geosptstruct");

function releaseFixture() {
  const pem = generateKeyPairSync("ed25519")
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString();
  const trust = {
    keys: { [product.keyId]: publicRaw(pem) },
    allowedHosts: ["github.com"],
  };
  const tag = productReleaseTag(product, "v2.0.7");
  const assets = ["windows", "linux"].map((platform) => {
    const name = `geosptstruct-2.0.7-${platform}-x86_64${platform === "windows" ? ".exe" : ".AppImage"}`;
    const asset = {
      name,
      platform,
      arch: "x86_64",
      kind: platform === "windows" ? "nsis" : "appimage",
      url: `https://github.com/${product.releaseRepo}/releases/download/${tag}/${name}`,
      size: 100,
      sha256: "a".repeat(64),
      keyId: product.keyId,
      minLauncherVersion: "0.2.0",
      executable: platform === "windows" ? "geosptstruct.exe" : null,
    };
    return {
      ...asset,
      signature: signBytes(packageMessage(product.id, "2.0.7", asset), pem),
    };
  });
  const release = {
    tag_name: tag,
    draft: false,
    prerelease: false,
    published_at: "2026-11-10T17:00:00Z",
    assets: assets.map((asset) => ({
      name: asset.name,
      size: asset.size,
      state: "uploaded",
      browser_download_url: asset.url,
      digest: `sha256:${asset.sha256}`,
    })),
  };
  const manifest = {
    schemaVersion: 1,
    appId: product.id,
    sourceRepo: product.sourceRepo,
    publisherRepo: product.publisherRepo,
    sourceCommit: "b".repeat(40),
    tag: "v2.0.7",
    version: "2.0.7",
    channel: "stable",
    notes: "GeoSPT 2.0.7",
    assets,
  };
  return { pem, trust, release, manifest };
}

test("o GeoSPT mantém fonte original, publicador central e chave já confiada", () => {
  assert.deepEqual(product, {
    id: "geosptstruct",
    name: "GeoSPT",
    sourceRepo: "itanervale/GEOSPT-STRUCT",
    publisherRepo: "ricardocorsini/launcher-struct",
    releaseRepo: "ricardocorsini/openstruct-catalog",
    keyId: "launcher-packages-v1",
  });
  const env = {
    GITHUB_REPOSITORY: product.publisherRepo,
    SOURCE_REPOSITORY: product.sourceRepo,
    SOURCE_COMMIT: "b".repeat(40),
    MIRROR_TOKEN_PRESENT: "true",
  };
  authorizeSource(product, env);
  assert.throws(() =>
    authorizeSource(product, { ...env, SOURCE_REPOSITORY: "attacker/fork" }),
  );
  assert.equal(
    base.apps.find((item) => item.id === product.id).releases.length,
    0,
  );
});

test("pacotes GeoSPT assinados dos dois sistemas entram no catálogo existente", () => {
  const f = releaseFixture();
  const verified = verifyRelease(
    seal(f.manifest, f.pem, product.keyId),
    f.release,
    product,
    f.trust,
  );
  const catalog = assembleCatalog(
    base,
    { geosptstruct: [verified] },
    f.trust,
    null,
  );
  const app = catalog.apps.find((item) => item.id === product.id);
  assert.equal(app.releases[0].version, "2.0.7");
  assert.equal(
    app.releases[0].assets.find((item) => item.platform === "windows")
      .executable,
    "geosptstruct.exe",
  );
  assert.equal(
    app.releases[0].assets.find((item) => item.platform === "linux").kind,
    "appimage",
  );
});

test("a assinatura compartilhada não permite reaproveitar metadados de outro produto", () => {
  const f = releaseFixture();
  const wrong = { ...f.manifest, appId: "armadurastruct" };
  assert.throws(() =>
    verifyRelease(
      seal(wrong, f.pem, product.keyId),
      f.release,
      product,
      f.trust,
    ),
  );
  assert.throws(() =>
    verifyRelease(
      seal(f.manifest, f.pem, product.keyId),
      { ...f.release, assets: f.release.assets.slice(0, 1) },
      product,
      f.trust,
    ),
  );
});
