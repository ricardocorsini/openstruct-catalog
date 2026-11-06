import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { valid } from 'semver';

export const packageMessage = (appId, version, asset) =>
  `OPENSTRUCT-PACKAGE-V1\n${appId}\n${version}\n${asset.platform}\n${asset.arch}\n${asset.kind}\n${asset.size}\n${asset.sha256}\n${asset.executable ?? ''}`;
export async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
export const signBytes = (bytes, pem) =>
  sign(null, Buffer.from(bytes), createPrivateKey(pem)).toString('base64');
export function publicRaw(pem) {
  return Buffer.from(createPublicKey(pem).export({ format: 'jwk' }).x, 'base64url').toString(
    'base64',
  );
}
export function verifyBytes(bytes, signature, rawKey) {
  const key = createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(rawKey, 'base64').toString('base64url') },
    format: 'jwk',
  });
  return verify(null, Buffer.from(bytes), key, Buffer.from(signature, 'base64'));
}
const id = (value) => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
const https = (value) => {
  const url = new URL(value);
  assert.equal(url.protocol, 'https:');
  assert.ok(!url.username && !url.password && (!url.port || url.port === '443'));
  return url;
};
export async function loadTrust() {
  return JSON.parse(await readFile(new URL('../catalog/trust.json', import.meta.url), 'utf8'));
}
export function validateCatalog(catalog, trust) {
  assert.equal(catalog.schemaVersion, 1, 'Esquema do catálogo não suportado');
  assert.ok(Number.isFinite(Date.parse(catalog.publishedAt)), 'Data inválida');
  assert.ok(Array.isArray(catalog.apps) && catalog.apps.length <= 100);
  const ids = new Set();
  for (const app of catalog.apps) {
    assert.ok(id(app.id) && !ids.has(app.id), 'ID inválido ou duplicado');
    ids.add(app.id);
    assert.ok(
      typeof app.name === 'string' &&
        app.name.length > 0 &&
        app.name.length <= 100 &&
        !/[\u0000-\u001f]/.test(app.name),
    );
    for (const field of ['tagline', 'summary', 'description', 'category', 'requirements', 'notice'])
      assert.equal(typeof app[field], 'string');
    assert.ok(/^#[0-9a-fA-F]{6}$/.test(app.color));
    assert.ok(['consolostruct-atlas', 'molastruct-gaia', 'openstruct-mark'].includes(app.icon));
    for (const link of ['website', 'repository', 'documentation']) https(app[link]);
    assert.ok(
      Array.isArray(app.features) &&
        app.features.every((f) => typeof f === 'string') &&
        app.features.length <= 30,
    );
    assert.ok(Array.isArray(app.releases) && app.releases.length <= 200);
    const versions = new Set();
    for (const release of app.releases) {
      assert.ok(valid(release.version) && !versions.has(release.version));
      versions.add(release.version);
      assert.ok(['stable', 'beta'].includes(release.channel));
      assert.ok(release.channel !== 'stable' || !release.version.split('+')[0].includes('-'));
      assert.ok(
        Number.isFinite(Date.parse(release.publishedAt)) && typeof release.notes === 'string',
      );
      assert.ok(release.assets.length > 0 && release.assets.length <= 8);
      const targets = new Set();
      for (const asset of release.assets) {
        const target = `${asset.platform}-${asset.arch}`;
        assert.ok(!targets.has(target), 'Pacote duplicado');
        targets.add(target);
        assert.ok(
          (asset.platform === 'linux' && asset.kind === 'appimage') ||
            (asset.platform === 'windows' && asset.kind === 'nsis'),
        );
        assert.ok(['x86_64', 'aarch64'].includes(asset.arch));
        assert.ok(Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= 2147483648);
        assert.ok(/^[a-f0-9]{64}$/.test(asset.sha256));
        assert.ok(valid(asset.minLauncherVersion));
        assert.ok(
          id(asset.keyId) && trust.keys[asset.keyId],
          'Chave pública de pacote não configurada',
        );
        assert.ok(
          trust.allowedHosts.includes(https(asset.url).hostname),
          'Origem de pacote não autorizada',
        );
        assert.equal(Buffer.from(asset.signature, 'base64').length, 64);
        if (asset.kind === 'nsis')
          assert.ok(
            typeof asset.executable === 'string' &&
              asset.executable.endsWith('.exe') &&
              !/[\\:\u0000]/.test(asset.executable) &&
              asset.executable.split('/').every((p) => p && p !== '.' && p !== '..'),
          );
        else assert.ok(asset.executable == null);
        assert.ok(
          verifyBytes(
            packageMessage(app.id, release.version, asset),
            asset.signature,
            trust.keys[asset.keyId],
          ),
          'Assinatura de pacote não confere',
        );
      }
    }
  }
  return catalog;
}
