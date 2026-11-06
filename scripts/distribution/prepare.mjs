import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { channelFor, releaseTag, tauriReleaseConfig, versionFromTag } from './release-lib.mjs';

const toolsRoot = fileURLToPath(new URL('../../', import.meta.url));
const config = JSON.parse(await readFile(join(toolsRoot, 'distribution.json'), 'utf8'));
const product = config.products.find((product) => product.id === process.env.PRODUCT_ID);
assert.ok(product, 'Produto não cadastrado');
assert.equal(process.env.GITHUB_REPOSITORY, product.sourceRepo, 'Repositório não autorizado');
assert.equal(process.env.DISTRIBUTION_REPO, config.hubRepo);
const tag = process.env.RELEASE_TAG;
const version = versionFromTag(tag);
const root = resolve(process.env.SOURCE_ROOT || '.');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const tauri = JSON.parse(await readFile(join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
assert.equal(pkg.version, version, 'package.json difere da tag');
assert.equal(tauri.version, version, 'tauri.conf.json difere da tag');
const cargo = await readFile(join(root, 'src-tauri/Cargo.toml'), 'utf8');
const section = cargo.match(/\[package\]([\s\S]*?)(?=\n\[|$)/)?.[1];
assert.equal(section?.match(/^version\s*=\s*"([^"]+)"/m)?.[1], version, 'Cargo.toml difere da tag');
const binary = tauri.mainBinaryName || section?.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
assert.match(binary ?? '', /^[A-Za-z0-9_-]+$/, 'Nome de executável inválido');
const plan = {
  ...product,
  version,
  tag,
  releaseTag: releaseTag(product.id, tag),
  channel: channelFor(version),
  executable: `${binary}.exe`,
};
await writeFile(join(root, '.openstruct-release-plan.json'), JSON.stringify(plan, null, 2));
await writeFile(
  join(root, '.openstruct-release-config.json'),
  JSON.stringify(
    tauriReleaseConfig(
      product.id,
      process.env.STRUCT_LAUNCHER_UPDATE_URL,
      process.env.STRUCT_LAUNCHER_UPDATE_PUBKEY,
    ),
  ),
);
console.log(`Versão validada: ${product.id} ${version} (${plan.channel})`);
