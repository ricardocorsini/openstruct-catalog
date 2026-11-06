import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

export function gh(args, input) {
  const result = spawnSync('gh', args, {
    input,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
    windowsHide: true,
  });
  if (result.error) throw new Error('Instale o GitHub CLI (gh) e execute gh auth login.');
  // Do not include captured stdout/stderr: key-generation/secret commands may contain private data.
  assert.equal(
    result.status,
    0,
    `Falhou: gh ${args.slice(0, 3).join(' ')}. Verifique login, permissões e conexão.`,
  );
  return result.stdout.trim();
}

export const api = (path, method = 'GET', body) => {
  const result = gh(
    ['api', path, '--method', method, ...(body ? ['--input', '-'] : [])],
    body ? JSON.stringify(body) : undefined,
  );
  return result ? JSON.parse(result) : null;
};

export function putFiles(repo, branch, files, message, request = api) {
  const encodedBranch = encodeURIComponent(branch);
  const head = request(`repos/${repo}/git/ref/heads/${encodedBranch}`).object.sha;
  const parent = request(`repos/${repo}/git/commits/${head}`);
  const tree = request(`repos/${repo}/git/trees`, 'POST', {
    base_tree: parent.tree.sha,
    tree: files.map(({ path, content }) => ({ path, content, type: 'blob', mode: '100644' })),
  });
  if (tree.sha === parent.tree.sha) return head;
  const commit = request(`repos/${repo}/git/commits`, 'POST', {
    message,
    tree: tree.sha,
    parents: [head],
  });
  request(`repos/${repo}/git/refs/heads/${encodedBranch}`, 'PATCH', {
    sha: commit.sha,
    force: false,
  });
  return commit.sha;
}

export async function publicJson(url, token) {
  const parsed = new URL(url);
  assert.equal(parsed.protocol, 'https:');
  assert.ok(['api.github.com', 'github.com'].includes(parsed.hostname));
  const headers = {
    'User-Agent': 'OpenStruct-Distribution',
    Accept: 'application/vnd.github+json',
  };
  // Never forward credentials to release assets or redirects.
  if (parsed.hostname === 'api.github.com' && token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  assert.ok(response.ok, `GitHub respondeu HTTP ${response.status}: ${parsed.pathname}`);
  assert.ok(Number(response.headers.get('content-length') ?? 0) < 3000000, 'JSON excede o limite');
  const chunks = [];
  let size = 0;
  for await (const bytes of response.body) {
    size += bytes.length;
    assert.ok(size < 3000000, 'JSON excede o limite');
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
