import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, save, verify, PROVIDERS, mask } from '../scripts/setup.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FC = 'fc-0123456789abcdef0123456789abcdef';
const EXA = '01234567-89ab-cdef-0123-456789abcdef';
const tmp = () => join(mkdtempSync(join(tmpdir(), 'sneak-setup-')), 'settings.json');

test('check: reports where each key is, never the key itself', () => {
  const path = tmp();
  assert.deepEqual([check({ env: {}, path }).firecrawl.set, check({ env: {}, path }).exa.set], [false, false]);
  const both = check({ env: { FIRECRAWL_API_KEY: FC }, path });
  assert.deepEqual([both.firecrawl.set, both.firecrawl.source, both.exa.set], [true, 'environment', false]);
  writeFileSync(path, JSON.stringify({ env: { EXA_API_KEY: EXA } }));
  const r = check({ env: {}, path });
  assert.deepEqual([r.exa.set, r.exa.source], [true, 'settings file']);
  assert.ok(!JSON.stringify(r).includes(EXA) && !JSON.stringify(both).includes(FC), 'no key in the output');
  assert.equal(r.firecrawl.key_url, 'https://www.firecrawl.dev/app/api-keys');
  assert.equal(r.exa.key_url, 'https://dashboard.exa.ai/api-keys');
});

test('save: writes the env block, keeps every other setting and the other key, and locks the file to its owner', () => {
  const path = tmp();
  writeFileSync(path, JSON.stringify({ model: 'opus', permissions: { allow: ['Bash(ls)'] }, env: { KEEP: '1', EXA_API_KEY: 'old-old-old-old-old-old' } }));
  const r = save({ FIRECRAWL_API_KEY: ` ${FC}\n` }, { env: {}, path });
  assert.deepEqual(r.saved, { firecrawl: mask(FC) });
  const s = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(s.env.FIRECRAWL_API_KEY, FC, 'whitespace is trimmed');
  assert.equal(s.env.EXA_API_KEY, 'old-old-old-old-old-old', 'a key that was not given is left alone');
  assert.equal(s.env.KEEP, '1');
  assert.equal(s.model, 'opus');
  assert.deepEqual(s.permissions, { allow: ['Bash(ls)'] });
  assert.equal(statSync(path).mode & 0o077, 0, 'not readable by group or others');
  save({ EXA_API_KEY: EXA }, { env: {}, path });
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).env.EXA_API_KEY, EXA);
});

test('save: creates the file when there is none', () => {
  const path = tmp();
  save({ FIRECRAWL_API_KEY: FC, EXA_API_KEY: EXA }, { env: {}, path });
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { env: { FIRECRAWL_API_KEY: FC, EXA_API_KEY: EXA } });
});

test('save: a key that does not look right, or no key at all, saves nothing and says why without echoing the key', () => {
  const path = tmp();
  writeFileSync(path, '{"a":1}');
  assert.throws(() => save({ FIRECRAWL_API_KEY: 'not a key' }, { env: {}, path }), /Firecrawl key does not look right/);
  assert.throws(() => save({ EXA_API_KEY: 'short' }, { env: {}, path }), /Exa key does not look right/);
  assert.throws(() => save({}, { env: {}, path }), /No keys were given/);
  assert.throws(() => save({ FIRECRAWL_API_KEY: 'fc-secretsecretsecretsecret with space' }, { env: {}, path }), (e) => !/secretsecret/.test(e.message));
  assert.equal(readFileSync(path, 'utf8'), '{"a":1}', 'the file is untouched');
});

test('save: never overwrites a settings file it cannot read', () => {
  const path = tmp();
  writeFileSync(path, '{ not json');
  assert.throws(() => save({ FIRECRAWL_API_KEY: FC }, { env: {}, path }), /not valid JSON/);
  assert.equal(readFileSync(path, 'utf8'), '{ not json');
  assert.match(check({ env: {}, path }).settings_error, /not valid JSON/);
});

test('verify: ok, rejected (401/403), unverified (network or server trouble) and missing are told apart', async () => {
  const path = tmp();
  const respond = (status) => async () => ({ status, ok: status >= 200 && status < 300 });
  const env = { FIRECRAWL_API_KEY: FC, EXA_API_KEY: EXA };
  assert.deepEqual(await verify({ env, path, fetchImpl: respond(200) }), { firecrawl: 'ok', exa: 'ok' });
  assert.deepEqual(await verify({ env, path, fetchImpl: respond(401) }), { firecrawl: 'rejected', exa: 'rejected' });
  assert.deepEqual(await verify({ env, path, fetchImpl: respond(503) }), { firecrawl: 'unverified', exa: 'unverified' });
  assert.deepEqual(await verify({ env, path, fetchImpl: async () => { throw new Error('offline'); } }), { firecrawl: 'unverified', exa: 'unverified' });
  assert.deepEqual(await verify({ env: {}, path, fetchImpl: respond(200) }), { firecrawl: 'missing', exa: 'missing' });
  // Each key goes to its own service, in the header that service documents.
  const calls = [];
  await verify({ env, path, fetchImpl: async (url, init) => { calls.push([String(url), init.headers]); return { status: 200, ok: true }; } });
  assert.ok(calls.some(([u, h]) => /firecrawl\.dev/.test(u) && h.authorization === `Bearer ${FC}`));
  assert.ok(calls.some(([u, h]) => /exa\.ai/.test(u) && h['x-api-key'] === EXA));
});

test('the command line: check prints JSON without keys; save reads stdin; a bad key exits non-zero and is not echoed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sneak-cli-'));
  const env = { ...process.env, CLAUDE_CONFIG_DIR: dir };
  delete env.FIRECRAWL_API_KEY; delete env.EXA_API_KEY;
  const run = (args, input) => execFileSync('node', [join(ROOT, 'scripts', 'setup.mjs'), ...args], { env, input, encoding: 'utf8' });
  assert.equal(JSON.parse(run(['check'])).firecrawl.set, false);
  const out = run(['save'], JSON.stringify({ FIRECRAWL_API_KEY: FC }));
  assert.match(out, /Saved Firecrawl key \(…cdef\)/);
  assert.ok(!out.includes(FC));
  assert.equal(JSON.parse(run(['check'])).firecrawl.source, 'settings file');
  let err = '';
  try { run(['save'], JSON.stringify({ EXA_API_KEY: 'bad' })); } catch (e) { err = String(e.stderr); }
  assert.match(err, /Exa key does not look right/);
});

test('the plugin reads both keys from environment variables, in the header each service documents, and holds no key', () => {
  const cfg = JSON.parse(readFileSync(join(ROOT, '.mcp.json'), 'utf8'));
  assert.equal(cfg.mcpServers.firecrawl.url, 'https://mcp.firecrawl.dev/v2/mcp');
  assert.equal(cfg.mcpServers.firecrawl.headers.Authorization, 'Bearer ${FIRECRAWL_API_KEY}');
  assert.equal(cfg.mcpServers.exa.url, 'https://mcp.exa.ai/mcp');
  assert.equal(cfg.mcpServers.exa.headers['x-api-key'], '${EXA_API_KEY}');
  for (const p of Object.values(PROVIDERS)) assert.ok(JSON.stringify(cfg).includes(`\${${p.envVar}}`));
});
