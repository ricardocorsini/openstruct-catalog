import assert from 'node:assert/strict';
import { readdir, readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve('.');
const plan = JSON.parse(await readFile('.openstruct-release-plan.json', 'utf8'));
const windows = process.env.RUNNER_OS === 'Windows';
const extension = windows ? '.exe' : '.AppImage';
async function walk(path) {
  const entries = await readdir(path, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const nested = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory()
        ? walk(join(path, entry.name))
        : entry.isFile()
          ? [join(path, entry.name)]
          : [],
    ),
  );
  return nested.flat();
}
const paths = (
  await Promise.all(
    ['target/release/bundle', 'src-tauri/target/release/bundle'].map((path) =>
      walk(join(root, path)),
    ),
  )
).flat();
const candidates = paths.filter(
  (path) => path.endsWith(extension) && (!windows || /[\\/]nsis[\\/]/.test(path)),
);
assert.equal(candidates.length, 1, 'Esperado exatamente um instalador para este sistema');
const name = `${plan.id}-${plan.version}-${windows ? 'windows' : 'linux'}-x86_64${extension}`;
await mkdir('release-output', { recursive: true });
await copyFile(candidates[0], join('release-output', name));
if (plan.id === 'launcher')
  await copyFile(`${candidates[0]}.sig`, join('release-output', `${name}.sig`));
await writeFile(
  join('release-output', `plan-${windows ? 'windows' : 'linux'}.json`),
  JSON.stringify(plan),
);
console.log(`Instalador coletado: ${name}`);
