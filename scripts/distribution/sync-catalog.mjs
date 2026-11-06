import { belongsToProduct } from './source.mjs';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import {
  assembleCatalog,
  launcherFeed,
  open,
  requireSigningKey,
  seal,
  verifyRelease,
} from './release-lib.mjs';
import { publicJson } from './github.mjs';

const config = JSON.parse(await readFile('distribution.json', 'utf8'));
const base = JSON.parse(await readFile('catalog/bundled.json', 'utf8'));
const trust = JSON.parse(await readFile('catalog/trust.json', 'utf8'));
requireSigningKey(process.env.CATALOG_SIGNING_KEY, config.catalogKeyId, trust);
let previous = null;
try {
  const envelope = JSON.parse(await readFile('catalog.signed.json', 'utf8'));
  previous = open(envelope, config.catalogKeyId, trust.keys[config.catalogKeyId]);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const byId = {};
for (const product of config.products) {
  // Fail the whole sync on a read/verification failure. Leave the last good catalog untouched.
  let releases = [];
  for (let page = 1; page <= 5; page++) {
    const batch = await publicJson(
      `https://api.github.com/repos/${product.releaseRepo}/releases?per_page=100&page=${page}`,
      process.env.GH_TOKEN,
    );
    assert.ok(Array.isArray(batch));
    releases.push(...batch);
    if (batch.length < 100) break;
    assert.ok(page < 5, 'Muitas releases; revise a política de retenção antes de continuar');
  }
  byId[product.id] = [];
  for (const release of releases.filter((release) => !release.draft)) {
    const metadata = release.assets.filter((asset) => asset.name === 'openstruct-release.json');
    // Existing manual releases without OpenStruct metadata are intentionally not offered.
    if (!metadata.length) continue;
    if (!belongsToProduct(product, release.tag_name)) continue;
    assert.equal(metadata.length, 1, 'Metadados duplicados');
    assert.equal(metadata[0].state, 'uploaded');
    assert.ok(metadata[0].size < 500000);
    const expected = `https://github.com/${product.releaseRepo}/releases/download/${release.tag_name}/openstruct-release.json`;
    assert.equal(metadata[0].browser_download_url, expected);
    const envelope = await publicJson(expected);
    byId[product.id].push(verifyRelease(envelope, release, product, trust));
  }
}
const catalog = assembleCatalog(base, byId, trust, previous);
// Complete all remote reads/validation before writing either endpoint.
const feed = launcherFeed(byId.launcher ?? []);
if (catalog !== previous) {
  await writeFile(
    'catalog.signed.json',
    JSON.stringify(seal(catalog, process.env.CATALOG_SIGNING_KEY, config.catalogKeyId), null, 2) +
      '\n',
  );
}
if (feed) {
  await mkdir('launcher', { recursive: true });
  await writeFile('launcher/latest.json', JSON.stringify(feed, null, 2) + '\n');
}
console.log(
  `Catálogo verificado: ${catalog.apps.reduce((count, app) => count + app.releases.length, 0)} versões de aplicativos.`,
);
