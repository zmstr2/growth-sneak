import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTIVITIES } from '../scripts/activities.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');

const walk = (dir, keep) => readdirSync(dir).flatMap((f) => {
  if (['node_modules', '.git', 'reports', '.impeccable'].includes(f)) return [];
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p, keep) : keep(p) ? [p] : [];
});

test('no API key appears anywhere in the plugin', () => {
  const hits = walk(ROOT, (p) => statSync(p).size < 3_000_000 && !/\.(png|jpe?g|webp|gif|pdf)$/i.test(p) && !p.includes('/tests/fixtures/'))
    .filter((p) => /(apikey_[0-9a-f]{20,}|fc-[0-9a-f]{24,}|exa[_-]?api[_-]?key\s*[:=]\s*['"][0-9a-f-]{20,})/i.test(readFileSync(p, 'utf8')) && !p.endsWith('setup.test.mjs'));
  assert.deepEqual(hits, [], `a key is in: ${hits.join(', ')}`);
});

test('scoring is gone: no scorer, rubric, model key or scores file is mentioned anywhere the plugin ships', () => {
  assert.ok(!existsSync(join(ROOT, 'scripts', 'score.mjs')) && !existsSync(join(ROOT, 'scripts', 'rubric.mjs')));
  const shipped = walk(ROOT, (p) => /\.(md|mjs|json|html)$/.test(p) && !p.includes('/tests/') && !p.includes('/docs/') && !p.endsWith('package-lock.json'));
  for (const f of shipped) {
    const text = readFileSync(f, 'utf8').replace(/data:[^"')]+/g, '');
    assert.ok(!/TYPESAFE|TypeSafe|\bJev\b|scores\.json|rubric\.mjs|score\.mjs|activity_levels/.test(text), `${f.slice(ROOT.length + 1)} still mentions scoring`);
  }
});

// ---------- voice ----------

test('the voice guide never uses hype words or judgment words about the company', () => {
  const text = read('references', 'voice.md');
  const body = text.replace(/"world-class", "unlock", "supercharge", "seamless"/g, '').replace(/\("weak", "failing", "behind"\)/g, '');
  for (const w of ['world-class', 'supercharge', 'seamless', 'game-changing', 'revolutionary']) assert.ok(!new RegExp(w, 'i').test(body), `hype word: ${w}`);
});

test('the Alexandria guide states the rules: discover first, price first, never accept terms, errors are not absences', () => {
  const md = read('references', 'alexandria.md');
  for (const rule of ['Discover before you retrieve', 'Call only what discovery returned', 'Know the price first', 'Never accept terms', 'never an absence']) assert.ok(md.includes(rule), rule);
  assert.match(md, /\| `ashbyhq-com`/);
  assert.match(md, /\| `upspring`/);
});

// ---------- the skill ----------

test('the skill names every step the pipeline needs, in order, with setup first and no stale rule', () => {
  const md = read('skills', 'sneak', 'SKILL.md');
  const order = ['## Setup', '## 0.', '## 1.', '## 2.', '## 3.', '## 4.', '## 5.', '## 6.'].map((h) => md.indexOf(h));
  assert.ok(order.every((i) => i > 0), 'a step is missing');
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.ok(!/It never recommends/.test(md));
  for (const must of ['alexandria.md', 'voice.md', 'Step 1 of 5', 'Step 5 of 5']) assert.ok(md.includes(must), must);
  assert.ok(!/of 6:/.test(md), 'the step count matches the steps');
});

test('first-run setup: MCP servers use OAuth URLs with no keys, and the skill points users to /mcp Authenticate, never the chat', () => {
  const plugin = JSON.parse(read('.claude-plugin', 'plugin.json'));
  assert.ok(!plugin.userConfig, 'no API key settings');
  const mcp = JSON.parse(read('.mcp.json')).mcpServers;
  assert.equal(mcp.firecrawl.url, 'https://mcp.firecrawl.dev/v2/mcp-oauth');
  assert.equal(mcp.exa.url, 'https://mcp.exa.ai/mcp');
  for (const k of ['firecrawl', 'exa']) assert.ok(!mcp[k].headers, k + ' sends no key header');
  assert.ok(!/user_config|API_KEY/.test(read('.mcp.json')), 'no key placeholders in .mcp.json');
  const md = read('skills', 'sneak', 'SKILL.md');
  const setup = md.slice(md.indexOf('## Setup'), md.indexOf('## 0.'));
  for (const must of ['/mcp', 'Authenticate', 'Do not start']) assert.ok(setup.includes(must), must);
  assert.match(setup, /not save it or repeat/i);
  assert.ok(read('README.md').includes('Authenticate'), 'the README explains sign-in');
});

test('paid social: the collector brief reads the public Meta Ad Library through Firecrawl and is honest about LinkedIn and TikTok', () => {
  const md = read('references', 'layers', 'paid.md');
  for (const must of ['facebook.com/ads/library', 'firecrawl_scrape', 'q=<domain>', 'advertiser name is the brand', 'first screen', 'couldnt_check', 'blocks Firecrawl']) assert.ok(md.includes(must), must);
  assert.match(md, /Never run it by default/, 'Upspring is opt-in');
});

// Every file path the instructions mention (starting with $P/, references/ or scripts/) must exist, so a rename or
// a deleted file cannot leave the skill, the agents or the reference notes pointing at nothing.
const walkMd = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walkMd(p) : p.endsWith('.md') ? [p] : [];
});
const PATH_RE = /(?<![A-Za-z0-9_./-])(\$P\/[A-Za-z0-9_./<>*-]*[A-Za-z0-9_>]|(?:references|scripts)\/[A-Za-z0-9_./<>*-]*[A-Za-z0-9_>])/g;

test('every file path the skill, agents and reference notes mention under $P/, references/ or scripts/ exists', () => {
  const files = [join(ROOT, 'skills', 'sneak', 'SKILL.md'), ...readdirSync(join(ROOT, 'agents')).map((f) => join(ROOT, 'agents', f)), ...walkMd(join(ROOT, 'references'))];
  assert.ok(files.length >= 8);
  const LAYERS = ['paid', 'owned', 'social', 'company'];
  let checked = 0;
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(PATH_RE)) {
      const rel = m[1].replace(/^\$P\//, '');
      const where = `${f.slice(ROOT.length + 1)} mentions ${m[1]}`;
      if (rel.includes('<layer>')) {
        for (const l of LAYERS) { assert.ok(existsSync(join(ROOT, rel.replace('<layer>', l))), `${where}: no brief for the ${l} layer`); checked++; }
      } else if (/[<*]/.test(rel)) continue;
      else { assert.ok(existsSync(join(ROOT, rel)), `${where}, which does not exist`); checked++; }
    }
  }
  assert.ok(checked >= 25, `only ${checked} paths were found; the pattern has stopped matching`);
});

test('the path check can fail: a path to a deleted file is not found', () => {
  const sample = 'Read `$P/references/channels.md` and run `node $P/scripts/gone.mjs`, then see references/taxonomy.md.';
  const found = [...sample.matchAll(PATH_RE)].map((m) => m[1].replace(/^\$P\//, ''));
  assert.deepEqual(found, ['references/channels.md', 'scripts/gone.mjs', 'references/taxonomy.md']);
  assert.deepEqual(found.filter((r) => !existsSync(join(ROOT, r))), ['references/channels.md', 'scripts/gone.mjs']);
});
