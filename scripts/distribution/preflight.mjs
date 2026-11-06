import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { distributionEndpoints, versionFromTag } from './release-lib.mjs';

const config = JSON.parse(
  await readFile(new URL('../../distribution.json', import.meta.url), 'utf8'),
);
const product = config.products.find((product) => product.id === process.env.PRODUCT_ID);
assert.ok(product, 'Produto não cadastrado');
assert.equal(product.sourceRepo, process.env.GITHUB_REPOSITORY, 'Repositório não autorizado');
versionFromTag(process.env.RELEASE_TAG);
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
