import { execFileSync } from 'node:child_process';
import { authorizeSource } from './source.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { distributionEndpoints, versionFromTag } from './release-lib.mjs';

const config = JSON.parse(
  await readFile(new URL('../../distribution.json', import.meta.url), 'utf8'),
);
const product = config.products.find((product) => product.id === process.env.PRODUCT_ID);
assert.ok(product, 'Produto não cadastrado');
versionFromTag(process.env.RELEASE_TAG);
authorizeSource(product, process.env);
if (product.publisherRepo) {
  assert.equal(
    execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    process.env.SOURCE_COMMIT,
  );
  const refs = execFileSync(
    'git',
    [
      'ls-remote',
      '--tags',
      `https://github.com/${product.sourceRepo}.git`,
      `refs/tags/${process.env.RELEASE_TAG}`,
      `refs/tags/${process.env.RELEASE_TAG}^{}`,
    ],
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n');
  const peeled = refs.find((line) => line.endsWith('^{}')) || refs[0];
  assert.equal(
    peeled.split(/\s+/)[0],
    process.env.SOURCE_COMMIT,
    'A tag não corresponde ao commit autorizado',
  );
}
if (product.id === 'launcher') {
  assert.equal(
    process.env.MIRROR_TOKEN_PRESENT,
    'true',
    'Configure OPENSTRUCT_DISTRIBUTION_TOKEN no launcher (PAT fino, Contents:write somente no hub público).',
  );
  assert.equal(
    process.env.TAURI_KEY_PRESENT,
    'true',
    'Configure TAURI_SIGNING_PRIVATE_KEY antes de publicar o launcher.',
  );
  assert.equal(process.env.STRUCT_LAUNCHER_UPDATE_URL, distributionEndpoints(config).updateUrl);
  assert.equal(process.env.STRUCT_LAUNCHER_UPDATE_PUBKEY, config.tauriPublicKey);
}
console.log('Pré-requisitos da publicação verificados.');
