import { productReleaseTag } from './source.mjs';
import assert from 'node:assert/strict';
import { prerelease, rcompare, valid } from 'semver';
import {
  packageMessage,
  publicRaw,
  signBytes,
  validateCatalog,
  verifyBytes,
} from '../security.mjs';

export function versionFromTag(tag) {
  assert.match(
    tag ?? '',
    /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
    'Use uma tag SemVer, por exemplo v0.3.1 ou v0.4.0-beta.1 (sem build metadata).',
  );
  const version = tag.slice(1);
  assert.equal(valid(version), version, 'Versão SemVer inválida');
  return version;
}

export const releaseTag = (id, tag) => (id === 'launcher' ? `launcher-${tag}` : tag);
export const channelFor = (version) => (prerelease(version) ? 'beta' : 'stable');

export function distributionBranch(config) {
  const branch = config.hubBranch ?? 'main'; // compatibility with already configured hubs
  assert.ok(
    typeof branch === 'string' && branch.length > 0 && !/[\s\u0000-\u001f]/.test(branch),
    'Branch de distribuição inválida',
  );
  return branch;
}

export function distributionEndpoints(config) {
  const base = `https://raw.githubusercontent.com/${config.hubRepo}/${encodeURIComponent(distributionBranch(config))}`;
  return { catalogUrl: `${base}/catalog.signed.json`, updateUrl: `${base}/launcher/latest.json` };
}

export function tauriReleaseConfig(productId, updateUrl, publicKey) {
  if (productId === 'launcher') {
    assert.ok(
      updateUrl?.startsWith('https://') && publicKey,
      'Configure a chave e o endpoint do updater',
    );
  }
  return {
    bundle: {
      createUpdaterArtifacts: productId === 'launcher',
      windows: { nsis: { installMode: 'currentUser' } },
    },
    ...(productId === 'launcher'
      ? { plugins: { updater: { pubkey: publicKey, endpoints: [updateUrl] } } }
      : {}),
  };
}

export function seal(payload, pem, keyId) {
  const text = JSON.stringify(payload);
  return { payload: text, signature: signBytes(text, pem), keyId };
}

export function open(envelope, keyId, publicKey) {
  assert.equal(envelope.keyId, keyId, 'Chave de assinatura inesperada');
  assert.equal(typeof envelope.payload, 'string');
  assert.ok(verifyBytes(envelope.payload, envelope.signature, publicKey), 'Assinatura inválida');
  return JSON.parse(envelope.payload);
}

// Bind signed metadata to the actual public GitHub release, never to arbitrary URLs.
export function verifyRelease(envelope, release, product, trust) {
  assert.equal(release.draft, false, 'Rascunhos não entram no catálogo');
  const manifest = open(envelope, product.keyId, trust.keys[product.keyId]);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.appId, product.id);
  assert.equal(manifest.sourceRepo, product.sourceRepo);
  if (product.publisherRepo) {
    assert.equal(manifest.publisherRepo, product.publisherRepo, 'Publicador divergente');
    assert.match(manifest.sourceCommit ?? '', /^[a-f0-9]{40}$/, 'Commit de origem ausente');
  }
  const version = versionFromTag(manifest.tag);
  assert.equal(manifest.version, version);
  assert.equal(release.tag_name, productReleaseTag(product, manifest.tag));
  assert.equal(manifest.channel, channelFor(version));
  assert.equal(Boolean(release.prerelease), manifest.channel === 'beta');
  assert.ok(Number.isFinite(Date.parse(release.published_at)), 'Data de publicação inválida');
  assert.equal(typeof manifest.notes, 'string');
  assert.ok(manifest.notes.length <= 50000);
  assert.equal(manifest.assets.length, 2, 'Windows e Linux precisam estar prontos juntos');
  const targets = new Set();
  for (const asset of manifest.assets) {
    const suffix = asset.platform === 'windows' ? '.exe' : '.AppImage';
    assert.ok(['windows', 'linux'].includes(asset.platform));
    assert.equal(asset.arch, 'x86_64');
    assert.ok(Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= 2147483648);
    assert.match(asset.sha256, /^[a-f0-9]{64}$/);
    assert.ok(valid(asset.minLauncherVersion));
    assert.equal(asset.kind, asset.platform === 'windows' ? 'nsis' : 'appimage');
    assert.ok(!targets.has(asset.platform), 'Sistema duplicado');
    targets.add(asset.platform);
    assert.match(asset.name, /^[A-Za-z0-9_.-]+$/);
    assert.ok(asset.name.endsWith(suffix));
    const expectedUrl = `https://github.com/${product.releaseRepo}/releases/download/${release.tag_name}/${asset.name}`;
    assert.equal(asset.url, expectedUrl, 'URL não corresponde à release');
    const files = release.assets.filter((file) => file.name === asset.name);
    assert.equal(files.length, 1, 'Instalador ausente ou duplicado na release');
    assert.equal(files[0].state, 'uploaded');
    assert.equal(files[0].size, asset.size, 'Tamanho não corresponde ao arquivo publicado');
    assert.equal(files[0].browser_download_url, asset.url);
    if (files[0].digest) assert.equal(files[0].digest, `sha256:${asset.sha256}`);
    assert.equal(asset.keyId, product.keyId, 'Chave de outro produto');
    if (product.id === 'launcher') {
      assert.equal(typeof asset.updaterSignature, 'string');
      assert.ok(asset.updaterSignature.length > 50, 'Assinatura Tauri ausente');
    }
    assert.ok(
      verifyBytes(
        packageMessage(product.id, version, asset),
        asset.signature,
        trust.keys[product.keyId],
      ),
      'Assinatura do instalador inválida',
    );
  }
  return {
    version,
    channel: manifest.channel,
    publishedAt: release.published_at,
    notes: manifest.notes,
    assets: manifest.assets,
  };
}

const packageFields = [
  'platform',
  'arch',
  'kind',
  'url',
  'size',
  'sha256',
  'signature',
  'keyId',
  'minLauncherVersion',
  'executable',
];
export const catalogRelease = (release) => ({
  ...release,
  assets: release.assets.map((asset) =>
    Object.fromEntries(packageFields.map((key) => [key, asset[key]])),
  ),
});

export function assembleCatalog(base, releasesById, trust, previous, now = new Date()) {
  const next = structuredClone(base);
  next.apps = next.apps.map((app) => ({
    ...app,
    releases: (releasesById[app.id] ?? [])
      .sort((a, b) => rcompare(a.version, b.version))
      .slice(0, 20)
      .map(catalogRelease),
  }));
  // A replay at the same timestamp is valid, but preserve identical payload bytes on a no-op.
  if (previous && JSON.stringify(next.apps) === JSON.stringify(previous.apps)) return previous;
  const floor = Math.max(
    Date.parse(base.publishedAt),
    previous ? Date.parse(previous.publishedAt) + 1 : 0,
  );
  next.publishedAt = new Date(Math.max(now.getTime(), floor)).toISOString();
  return validateCatalog(next, trust);
}

export function launcherFeed(releases) {
  const latest = releases
    .filter((release) => release.channel === 'stable')
    .sort((a, b) => rcompare(a.version, b.version))[0];
  if (!latest) return null;
  return {
    version: latest.version,
    notes: latest.notes,
    pub_date: latest.publishedAt,
    platforms: Object.fromEntries(
      latest.assets.map((asset) => [
        `${asset.platform === 'windows' ? 'windows' : 'linux'}-x86_64`,
        { signature: asset.updaterSignature, url: asset.url },
      ]),
    ),
  };
}

export function requireSigningKey(pem, keyId, trust) {
  assert.ok(pem, 'Chave de assinatura não configurada nos Secrets');
  assert.equal(publicRaw(pem), trust.keys[keyId], 'Secret e chave pública não correspondem');
}

export function missingUploads(files, release) {
  assert.equal(release.draft, true, 'Somente rascunhos recebem arquivos');
  return files.filter((file) => {
    const existing = release.assets.filter((asset) => asset.name === file.name);
    assert.ok(existing.length <= 1);
    if (!existing.length) return true;
    assert.equal(
      existing[0].state,
      'uploaded',
      'Upload anterior incompleto; remova o rascunho e tente novamente',
    );
    assert.equal(
      existing[0].digest,
      `sha256:${file.sha256}`,
      'O rascunho contém bytes diferentes. Remova apenas o rascunho antes de repetir, ou use uma nova versão.',
    );
    return false;
  });
}
