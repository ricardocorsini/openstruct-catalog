import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicRaw } from '../security.mjs';
import { releaseNotes, open, verifyRelease, catalogRelease, launcherFeed } from './release-lib.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const notes = '## Novidades\n\n- Correção da rigidez e atualização da seção.\n- Instalação em português: ações e verificações.';

test('notas reais preservam português e rejeitam vazio, placeholders, controle e excesso', () => {
  assert.equal(releaseNotes(`\uFEFF  ${notes.replaceAll('\n', '\r\n')}\r\n`), notes);
  for (const bad of [undefined, {}, '', '\n  ', 'TODO', '# Em breve', '## Novidades\n\n- TBD', 'x\0y', 'x'.repeat(50001)])
    assert.throws(() => releaseNotes(bad));
  assert.equal(releaseNotes('x'.repeat(50000)).length, 50000);
});

// Full prepare -> collect (two OSes) -> publish flow, with a local fake GitHub CLI.
// No network, real credentials, installation or release publication is used.
test('notas versionadas são assinadas antes da publicação e chegam ao catálogo/feed', async (t) => {
  const dir = await mkdtemp(join(root, '.notes-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const tooling = join(dir, 'tooling');
  const source = join(dir, 'source');
  await cp(join(root, 'scripts'), join(tooling, 'scripts'), { recursive: true });
  await cp(join(root, 'distribution.json'), join(tooling, 'distribution.json'));
  await mkdir(join(tooling, 'catalog'), { recursive: true });
  const pem = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const config = JSON.parse(await readFile(join(root, 'distribution.json'), 'utf8'));
  const product = config.products.find((p) => p.id === 'launcher');
  const trust = { keys: { [product.keyId]: publicRaw(pem) }, allowedHosts: ['github.com'] };
  await writeFile(join(tooling, 'catalog/trust.json'), JSON.stringify(trust));
  await mkdir(join(source, 'src-tauri'), { recursive: true });
  await mkdir(join(source, '.github/release-notes'), { recursive: true });
  await writeFile(join(source, 'package.json'), JSON.stringify({ version: '1.2.3' }));
  await writeFile(join(source, 'src-tauri/tauri.conf.json'), JSON.stringify({ version: '1.2.3' }));
  await writeFile(join(source, 'src-tauri/Cargo.toml'), '[package]\nname = "launcher"\nversion = "1.2.3"\n');
  const env = {
    ...process.env, PRODUCT_ID: product.id, GITHUB_REPOSITORY: product.sourceRepo,
    SOURCE_REPOSITORY: product.sourceRepo, RELEASE_TAG: 'v1.2.3', DISTRIBUTION_REPO: config.hubRepo,
    STRUCT_LAUNCHER_UPDATE_URL: 'https://example.com/latest.json', STRUCT_LAUNCHER_UPDATE_PUBKEY: 'test',
    PACKAGE_SIGNING_KEY: pem, DISTRIBUTION_TOKEN: '', GH_TOKEN: 'fake',
  };
  function run(script, extra = {}) {
    return spawnSync(process.execPath, [join(tooling, 'scripts/distribution', script)], {
      cwd: source, env: { ...env, ...extra }, encoding: 'utf8',
    });
  }
  function succeeds(result) { assert.equal(result.status, 0, result.stderr); }
  assert.notEqual(run('prepare.mjs').status, 0, 'missing notes must stop preparation');
  await writeFile(join(source, '.github/release-notes/v1.2.3.md'), notes);
  assert.notEqual(run('prepare.mjs', { RELEASE_TAG: '../v1.2.3' }).status, 0);
  succeeds(run('prepare.mjs'));
  const plan = JSON.parse(await readFile(join(source, '.openstruct-release-plan.json'), 'utf8'));
  assert.equal(plan.notes, notes);
  for (const [os, folder, name] of [['Windows', 'nsis', 'setup.exe'], ['Linux', 'appimage', 'app.AppImage']]) {
    const bundle = join(source, 'target/release/bundle', folder);
    await mkdir(bundle, { recursive: true });
    await writeFile(join(bundle, name), `test installer ${os}`);
    await writeFile(join(bundle, `${name}.sig`), 'Tauri-test-signature-'.repeat(5));
    succeeds(run('collect.mjs', { RUNNER_OS: os }));
  }
  const output = join(source, 'release-output');
  const linuxPlan = join(output, 'plan-linux.json');
  assert.deepEqual(JSON.parse(await readFile(linuxPlan, 'utf8')), plan);
  const bin = join(dir, 'bin');
  await mkdir(bin);
  await writeFile(join(bin, 'package.json'), JSON.stringify({ type: 'commonjs' }));
  const state = join(dir, 'github.json');
  const initial = { id: 123, tag_name: 'launcher-v1.2.3', draft: true, prerelease: false, body: 'Old draft notes', assets: [] };
  await writeFile(state, JSON.stringify(initial));
  await writeFile(join(bin, 'gh'), `#!${process.execPath}
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const args = process.argv.slice(2);
const file = process.env.FAKE_GH_STATE;
let release = JSON.parse(fs.readFileSync(file, 'utf8'));
let result;
if (args[0] === 'release' && args[1] === 'upload') {
  for (const name of args.slice(3, args.indexOf('--repo'))) {
    const bytes = fs.readFileSync(name);
    release.assets.push({ name: path.basename(name), size: bytes.length, state: 'uploaded', digest: 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex'), browser_download_url: 'https://github.com/${product.releaseRepo}/releases/download/launcher-v1.2.3/' + path.basename(name) });
  }
} else if (args[0] === 'api') {
  const method = args[args.indexOf('--method') + 1];
  if (method === 'POST') {
    release = { id: 123, assets: [], ...JSON.parse(fs.readFileSync(0, 'utf8')) };
    result = release;
  } else if (method === 'PATCH') {
    Object.assign(release, JSON.parse(fs.readFileSync(0, 'utf8')), { published_at: '2026-11-11T01:00:00Z' });
    result = release;
  } else result = args[1].includes('?') ? (release ? [release] : []) : release;
} else process.exit(1);
fs.writeFileSync(file, JSON.stringify(release));
if (result) process.stdout.write(JSON.stringify(result));
`, { mode: 0o755 });
  env.PATH = `${bin}${delimiter}${process.env.PATH}`;
  env.FAKE_GH_STATE = state;

  await writeFile(linuxPlan, JSON.stringify({ ...plan, notes: 'Notas divergentes' }));
  assert.notEqual(run('publish.mjs').status, 0);
  assert.deepEqual(JSON.parse(await readFile(state, 'utf8')), initial);
  for (const platform of ['windows', 'linux'])
    await writeFile(join(output, `plan-${platform}.json`), JSON.stringify({ ...plan, notes: 'TODO' }));
  assert.notEqual(run('publish.mjs').status, 0, 'publisher must revalidate notes before API calls');
  assert.deepEqual(JSON.parse(await readFile(state, 'utf8')), initial);
  for (const platform of ['windows', 'linux'])
    await writeFile(join(output, `plan-${platform}.json`), JSON.stringify(plan));
  succeeds(run('publish.mjs'));
  const published = JSON.parse(await readFile(state, 'utf8'));
  assert.equal(published.body, notes);
  assert.equal(published.draft, false);
  const envelope = JSON.parse(await readFile(join(output, 'openstruct-release.json'), 'utf8'));
  assert.equal(open(envelope, product.keyId, trust.keys[product.keyId]).notes, notes);
  const verified = verifyRelease(envelope, published, product, trust);
  assert.equal(catalogRelease(verified).notes, notes);
  assert.equal(launcherFeed([verified]).notes, notes);
  assert.throws(() => open({ ...envelope, payload: envelope.payload.replace('Correção', 'Alteração') }, product.keyId, trust.keys[product.keyId]));
  assert.notEqual(run('publish.mjs').status, 0, 'published releases cannot be overwritten');
  assert.deepEqual(JSON.parse(await readFile(state, 'utf8')), published);

  // Identical draft retry succeeds; changed signed notes never overwrite existing metadata.
  await writeFile(state, JSON.stringify({ ...published, draft: true }));
  for (const platform of ['windows', 'linux'])
    await writeFile(join(output, `plan-${platform}.json`), JSON.stringify({ ...plan, notes: `${notes}\n\nNova nota.` }));
  assert.notEqual(run('publish.mjs').status, 0);
  assert.equal(JSON.parse(await readFile(state, 'utf8')).body, notes);
  for (const platform of ['windows', 'linux'])
    await writeFile(join(output, `plan-${platform}.json`), JSON.stringify(plan));
  succeeds(run('publish.mjs'));

  // A brand new release also uses the notes when creating its draft.
  await writeFile(state, 'null');
  succeeds(run('publish.mjs'));
  assert.equal(JSON.parse(await readFile(state, 'utf8')).body, notes);
});
