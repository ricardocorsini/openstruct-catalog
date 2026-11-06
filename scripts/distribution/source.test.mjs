import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorizeSource, productReleaseTag, belongsToProduct } from './source.mjs';
const product = {
  id: 'armadurastruct',
  sourceRepo: 'owner/arm',
  publisherRepo: 'owner/launcher',
  releaseRepo: 'owner/hub',
};
const env = {
  GITHUB_REPOSITORY: 'owner/launcher',
  SOURCE_REPOSITORY: 'owner/arm',
  SOURCE_COMMIT: 'a'.repeat(40),
  MIRROR_TOKEN_PRESENT: 'true',
};
test('delegated publication binds the publisher, source and immutable commit', () => {
  authorizeSource(product, env);
  for (const patch of [
    { GITHUB_REPOSITORY: 'attacker/fork' },
    { SOURCE_REPOSITORY: 'attacker/fork' },
    { SOURCE_COMMIT: 'master' },
    { MIRROR_TOKEN_PRESENT: 'false' },
  ])
    assert.throws(() => authorizeSource(product, { ...env, ...patch }));
});
test('ordinary products retain their existing publication route', () => {
  const direct = { id: 'molastruct', sourceRepo: 'owner/mola', releaseRepo: 'owner/mola' };
  authorizeSource(direct, { GITHUB_REPOSITORY: 'owner/mola' });
  assert.equal(productReleaseTag(direct, 'v1.0.0'), 'v1.0.0');
});
test('mirrored applications never consume a different product release', () => {
  assert.equal(productReleaseTag(product, 'v0.1.1'), 'armadurastruct-v0.1.1');
  assert.equal(belongsToProduct(product, 'launcher-v0.2.1'), false);
  assert.equal(belongsToProduct(product, 'v0.1.1'), false);
  assert.equal(belongsToProduct(product, 'armadurastruct-v0.1.1'), true);
});
