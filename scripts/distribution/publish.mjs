import assert from 'node:assert/strict';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { packageMessage, sha256, signBytes } from '../security.mjs';
import { missingUploads, requireSigningKey, seal, versionFromTag } from './release-lib.mjs';
import { api, gh } from './github.mjs';

const config = JSON.parse(
  await readFile(new URL('../../distribution.json', import.meta.url), 'utf8'),
);
const trust = JSON.parse(
  await readFile(new URL('../../catalog/trust.json', import.meta.url), 'utf8'),
);
const product = config.products.find((product) => product.id === process.env.PRODUCT_ID);
assert.ok(product);
assert.equal(process.env.GITHUB_REPOSITORY, product.sourceRepo);
assert.equal(process.env.DISTRIBUTION_REPO, config.hubRepo);
const expectedVersion = versionFromTag(process.env.RELEASE_TAG);
requireSigningKey(process.env.PACKAGE_SIGNING_KEY, product.keyId, trust);
const directory = process.env.RELEASE_OUTPUT || 'release-output';
const plans = await Promise.all(
  ['windows', 'linux'].map((platform) =>
    readFile(join(directory, `plan-${platform}.json`), 'utf8').then(JSON.parse),
  ),
);
assert.deepEqual(plans[0], plans[1], 'Os dois builds precisam vir da mesma versão');
const plan = plans[0];
for (const key of ['id', 'sourceRepo', 'releaseRepo', 'keyId'])
  assert.equal(plan[key], product[key]);
assert.equal(plan.tag, process.env.RELEASE_TAG);
assert.equal(plan.version, expectedVersion);
assert.equal(plan.releaseTag, product.id === 'launcher' ? `launcher-${plan.tag}` : plan.tag);
assert.equal(plan.channel, expectedVersion.includes('-') ? 'beta' : 'stable');
const files = await readdir(directory);
const assets = [];
for (const platform of ['windows', 'linux']) {
  const name = `${plan.id}-${plan.version}-${platform}-x86_64${platform === 'windows' ? '.exe' : '.AppImage'}`;
  assert.ok(files.includes(name), `Instalador ausente: ${platform}`);
  const path = join(directory, name);
  const asset = {
    name,
    platform,
    arch: 'x86_64',
    kind: platform === 'windows' ? 'nsis' : 'appimage',
    url: `https://github.com/${product.releaseRepo}/releases/download/${plan.releaseTag}/${name}`,
    size: (await stat(path)).size,
    sha256: await sha256(path),
    keyId: product.keyId,
    minLauncherVersion: '0.2.0',
    executable: platform === 'windows' ? plan.executable : null,
  };
  asset.signature = signBytes(
    packageMessage(product.id, plan.version, asset),
    process.env.PACKAGE_SIGNING_KEY,
  );
  if (product.id === 'launcher')
    asset.updaterSignature = (await readFile(`${path}.sig`, 'utf8')).trim();
  assets.push(asset);
}
// Only this job has Contents:write; build jobs cannot publish a partial release.
const existing = api(`repos/${product.releaseRepo}/releases?per_page=100`).find(
  (release) => release.tag_name === plan.releaseTag,
);
assert.ok(
  !existing || existing.draft,
  'Versão já publicada. Crie outra tag; não substitua instaladores publicados.',
);
let release = existing;
if (!release)
  release = api(`repos/${product.releaseRepo}/releases`, 'POST', {
    tag_name: plan.releaseTag,
    name: `${product.name} ${plan.version}`,
    draft: true,
    prerelease: plan.channel === 'beta',
    ...(product.sourceRepo === product.releaseRepo
      ? { target_commitish: process.env.GITHUB_SHA }
      : {}),
    body: `Versão ${plan.version} de ${product.name}.\n\nCódigo: https://github.com/${product.sourceRepo}/tree/${plan.tag}`,
  });
const manifest = {
  schemaVersion: 1,
  appId: product.id,
  sourceRepo: product.sourceRepo,
  version: plan.version,
  tag: plan.tag,
  channel: plan.channel,
  notes: release.body || `${product.name} ${plan.version}`,
  assets,
};
const metadataPath = join(directory, 'openstruct-release.json');
await writeFile(
  metadataPath,
  JSON.stringify(seal(manifest, process.env.PACKAGE_SIGNING_KEY, product.keyId), null, 2),
);
const checksumPath = join(directory, 'SHA256SUMS.txt');
await writeFile(
  checksumPath,
  assets.map((asset) => `${asset.sha256}  ${asset.name}`).join('\n') + '\n',
);
const uploadPaths = [
  ...assets.map((asset) => join(directory, asset.name)),
  ...(product.id === 'launcher' ? assets.map((asset) => join(directory, `${asset.name}.sig`)) : []),
  checksumPath,
  metadataPath,
];
const uploadFiles = await Promise.all(
  uploadPaths.map(async (path) => ({
    path,
    name: path.split(/[\\/]/).at(-1),
    sha256: await sha256(path),
  })),
);
const current = api(`repos/${product.releaseRepo}/releases/${release.id}`);
const missing = missingUploads(uploadFiles, current);
// Never clobber an asset, including when a draft was published manually during this job.
if (missing.length)
  gh([
    'release',
    'upload',
    plan.releaseTag,
    ...missing.map((file) => file.path),
    '--repo',
    product.releaseRepo,
  ]);
assert.equal(api(`repos/${product.releaseRepo}/releases/${release.id}`).draft, true);
api(`repos/${product.releaseRepo}/releases/${release.id}`, 'PATCH', {
  draft: false,
  prerelease: plan.channel === 'beta',
});
console.log(`Publicada: https://github.com/${product.releaseRepo}/releases/tag/${plan.releaseTag}`);
if (process.env.DISTRIBUTION_TOKEN) {
  const previous = process.env.GH_TOKEN;
  try {
    process.env.GH_TOKEN = process.env.DISTRIBUTION_TOKEN;
    api(`repos/${config.hubRepo}/dispatches`, 'POST', {
      event_type: 'openstruct-release-published',
    });
  } catch {
    console.warn(
      'A publicação terminou. O catálogo será atualizado pela próxima execução periódica.',
    );
  } finally {
    process.env.GH_TOKEN = previous;
  }
}
