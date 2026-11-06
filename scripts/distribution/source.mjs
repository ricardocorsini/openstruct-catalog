import assert from 'node:assert/strict';

// A delegated publisher is an explicit repository allowlist, not a caller-supplied role.
export function authorizeSource(product, env) {
  assert.equal(
    env.GITHUB_REPOSITORY,
    product.publisherRepo ?? product.sourceRepo,
    'Repositório publicador não autorizado',
  );
  assert.equal(
    env.SOURCE_REPOSITORY || env.GITHUB_REPOSITORY,
    product.sourceRepo,
    'Repositório de código não autorizado',
  );
  if (product.publisherRepo) {
    assert.match(env.SOURCE_COMMIT ?? '', /^[a-f0-9]{40}$/, 'Informe o commit imutável do código');
    assert.equal(env.MIRROR_TOKEN_PRESENT, 'true', 'Token de publicação do hub ausente');
  }
}

export const productReleaseTag = (product, tag) =>
  product.releaseRepo === product.sourceRepo ? tag : `${product.id}-${tag}`;

export const belongsToProduct = (product, tag) =>
  product.releaseRepo === product.sourceRepo ? /^v\d/.test(tag) : tag.startsWith(`${product.id}-v`);
