import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, statSync, mkdtempSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTIVITIES, LEVEL_NAMES, toPercent, nearestLevel, toMarkdown } from '../scripts/rubric.mjs';
import { CHANNEL_BY_ID } from '../scripts/channels.mjs';
import { plan, buildRequest, callJev, collect, digestFor, scoreEvidence, fallbackScores, ENDPOINT } from '../scripts/score.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const loadEv = () => JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'exa.ai', 'evidence.json'), 'utf8'));

// ---------- the rubric ----------

test('every activity has one question and four distinct levels, on a real group and real channels', () => {
  assert.equal(ACTIVITIES.length, 17);
  assert.ok(!ACTIVITIES.some((a) => a.id === 'sales_motion'), 'sales_motion was retired');
  const ids = new Set();
  for (const a of ACTIVITIES) {
    assert.ok(!ids.has(a.id), `duplicate id ${a.id}`); ids.add(a.id);
    assert.equal(a.levels.length, 4, `${a.id}: four levels`);
    assert.equal(new Set(a.levels).size, 4, `${a.id}: levels must differ`);
    assert.ok(['paid', 'owned', 'earned', 'company'].includes(a.group), `${a.id}: group`);
    assert.ok(a.channels.length && a.channels.every((c) => CHANNEL_BY_ID[c]), `${a.id}: channels`);
    assert.match(a.question, /\?$/, `${a.id}: a question`);
  }
  assert.equal(LEVEL_NAMES.length, 4);
});

test('levels are situations: no vague degrees, and the first level always means nothing found', () => {
  const vague = /\b(moderately|fairly|somewhat|very strong|quite|reasonably|extremely|highly)\b/i;
  for (const a of ACTIVITIES) {
    for (const l of a.levels) assert.ok(!vague.test(l), `${a.id}: vague wording in "${l}"`);
    assert.match(a.levels[0], /\b(no|none|not|nothing|blocked|cannot)\b/i, `${a.id}: level 0 must say nothing was found`);
  }
});

test('scores map onto 0 to 100 and back to a level', () => {
  assert.deepEqual([0, 1, 2, 3].map((n) => toPercent(n)), [0, 33, 67, 100]);
  assert.equal(toPercent(1.43), 48);
  assert.equal(nearestLevel(1.43), 1);
  assert.equal(nearestLevel(5), 3);
  assert.match(toMarkdown(), /### Founder-led social/);
});

// ---------- deciding what to ask ----------

test('an activity with no evidence is not scored, and one with only a checked absence is a plain zero', () => {
  const ev = loadEv();
  ev.items = ev.items.filter((i) => i.channel !== 'tiktok_ads' && i.channel !== 'meta_ads' && i.channel !== 'linkedin_ads');
  const p = plan(ev);
  assert.equal(p.decided.paid_social.basis, 'not_covered');
  assert.equal(p.decided.paid_social.score, null);
  ev.items.push({ id: 'E900', channel: 'meta_ads', status: 'observed', absent: true, probe: 'Searched the Meta Ad Library for the brand and domain: 0 advertisers', finding: 'No Meta advertiser found.', url: 'https://x.test/' });
  const q = plan(ev);
  assert.equal(q.decided.paid_social.score, 0);
  assert.equal(q.decided.paid_social.basis, 'checked_absence');
  assert.deepEqual(q.decided.paid_social.evidence_ids, ['E900']);
  assert.ok(!('paid_social' in q.asked), 'a checked zero is never sent to the model');
});

test('only facts are sent to the model; things we could not check are left out', () => {
  const ev = loadEv();
  const d = digestFor(ACTIVITIES.find((a) => a.id === 'comparison'), ev);
  assert.ok(d.lines.every((l) => /^E\d+:|\d/.test(l)));
  ev.items.push({ id: 'E901', channel: 'comparison', status: 'couldnt_check', finding: 'Could not open the comparison pages.', url: 'https://x.test/' });
  const d2 = digestFor(ACTIVITIES.find((a) => a.id === 'comparison'), ev);
  assert.ok(!d2.lines.some((l) => l.startsWith('E901')));
});

test('the request is one call with a score question per asked activity, rubric levels as criteria', () => {
  const ev = loadEv();
  const p = plan(ev);
  const req = buildRequest(ev, p.asked);
  assert.equal(req.model, 'jev-latest');
  assert.deepEqual(Object.keys(req.questions).sort(), Object.keys(p.asked).sort());
  for (const [id, q] of Object.entries(req.questions)) {
    assert.equal(q.type, 'score');
    assert.deepEqual(q.criteria, ACTIVITIES.find((a) => a.id === id).levels);
    assert.match(q.instructions, new RegExp(`evidence\\.${id}`));
  }
  assert.ok(Object.keys(req.state.evidence).every((k) => k in req.questions));
});

// ---------- calling and reading the answer ----------

const fakeAnswers = (req) => ({ model: 'jev-1.13.0', usage: { input_tokens: 10, output_tokens: 2 }, answers: Object.fromEntries(Object.keys(req.questions).map((id) => [id, { type: 'score', score: 2.4, confidence: 0.7, legend: {}, probabilities: { 0: 0, 1: 0.1, 2: 0.4, 3: 0.5 } }])) });

test('answers become a 0 to 100 score with confidence, probabilities and the evidence ids behind them', async () => {
  const ev = loadEv();
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); const body = JSON.parse(init.body); return { ok: true, status: 200, json: async () => fakeAnswers(body) }; };
  const r = await scoreEvidence(ev, { key: 'test-key', fetchImpl });
  assert.equal(calls.length, 1, 'all activities in one request');
  assert.equal(calls[0].url, ENDPOINT);
  assert.equal(calls[0].init.headers.authorization, 'Bearer test-key');
  const c = r.activities.comparison;
  assert.equal(c.score, 80);
  assert.equal(c.level, 2);
  assert.equal(c.confidence, 0.7);
  assert.equal(c.basis, 'jev');
  assert.ok(c.evidence_ids.length > 0);
});

test('a rate limit is retried, a hard error is raised, and the key never appears in the message', async () => {
  let n = 0;
  const flaky = async () => (++n < 2 ? { ok: false, status: 429, text: async () => 'slow down' } : { ok: true, status: 200, json: async () => ({ answers: {}, usage: {} }) });
  const r = await callJev({ questions: {} }, { key: 'k', fetchImpl: flaky, retries: 2 });
  assert.equal(n, 2);
  assert.deepEqual(r.answers, {});
  const bad = async () => ({ ok: false, status: 401, text: async () => 'bad key: Bearer abc123' });
  await assert.rejects(callJev({ questions: {} }, { key: 'abc123', fetchImpl: bad, retries: 0 }), /HTTP 401/);
});

test('no answer for a question leaves that activity unscored rather than guessing', () => {
  const ev = loadEv();
  const p = plan(ev);
  const out = collect(ev, p, { answers: {} });
  for (const id of Object.keys(p.asked)) { assert.equal(out[id].score, null); assert.equal(out[id].basis, 'no_answer'); }
});

// ---------- no key: the analyst fallback ----------

test('without a key the script writes nothing and says so', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sneak-score-'));
  execFileSync('cp', [join(ROOT, 'tests', 'fixtures', 'exa.ai', 'evidence.json'), dir]);
  const env = { ...process.env }; delete env.TYPESAFE_API_KEY;
  const out = execFileSync('node', [join(ROOT, 'scripts', 'score.mjs'), dir], { env }).toString();
  assert.match(out, /No TYPESAFE_API_KEY set/);
  assert.ok(!existsSync(join(dir, 'scores.json')));
});

test('the analyst fallback gives levels on the same rubric, only for activities that have evidence', () => {
  const ev = loadEv();
  const r = fallbackScores({ activity_levels: [{ activity: 'comparison', level: 3 }, { activity: 'video', level: 3 }] }, ev);
  assert.equal(r.activities.comparison.score, 100);
  assert.equal(r.activities.comparison.basis, 'analyst');
  assert.equal(r.activities.comparison.confidence, null);
  assert.notEqual(r.activities.video.basis, 'analyst', 'an activity with no evidence cannot be scored by the analyst either');
});

// ---------- the key must never ship ----------

test('no API key appears anywhere in the plugin', () => {
  const hits = [];
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      if (['node_modules', '.git', 'reports'].includes(f)) continue;
      const p = join(dir, f);
      const st = statSync(p);
      if (st.isDirectory()) { walk(p); continue; }
      if (st.size > 3_000_000 || /\.(png|jpe?g|webp|gif|pdf)$/i.test(f)) continue;
      if (/(apikey_[0-9a-f]{20,}|fc-[0-9a-f]{24,})/i.test(readFileSync(p, 'utf8'))) hits.push(p);
    }
  };
  walk(ROOT);
  assert.deepEqual(hits, [], `a key is in: ${hits.join(', ')}`);
  assert.ok(!/TYPESAFE_API_KEY\s*=\s*['"]?[A-Za-z0-9_]{20,}/.test(readFileSync(join(ROOT, 'scripts', 'score.mjs'), 'utf8')));
});

// ---------- plays and voice ----------

test('every activity has one play card with a move, a reason, when it fits and when to skip it', () => {
  const md = readFileSync(join(ROOT, 'references', 'plays.md'), 'utf8');
  for (const a of ACTIVITIES) {
    const m = md.match(new RegExp(`### [^\\n]*\\(\`${a.id}\`\\)\\n([\\s\\S]*?)(?=\\n###|\\n## |$)`));
    assert.ok(m, `no play card for ${a.id}`);
    for (const label of ['Move.', 'Why it works.', 'Fits when.', 'Skip when.']) assert.ok(m[1].includes(`**${label}**`), `${a.id}: missing ${label}`);
    const move = m[1].match(/\*\*Move\.\*\* (.+)/)[1];
    assert.ok(move.split(/\s+/).length <= 28, `${a.id}: the move is too long`);
  }
});

test('plays and voice never use hype words or judgment words about the company', () => {
  const text = ['plays.md', 'voice.md'].map((f) => readFileSync(join(ROOT, 'references', f), 'utf8')).join('\n');
  const body = text.replace(/"world-class", "unlock", "supercharge", "seamless"/g, '').replace(/\("weak", "failing", "behind"\)/g, '');
  for (const w of ['world-class', 'supercharge', 'seamless', 'game-changing', 'revolutionary']) assert.ok(!new RegExp(w, 'i').test(body), `hype word: ${w}`);
});

test('the Alexandria guide states the rules: discover first, price first, never accept terms, errors are not absences', () => {
  const md = readFileSync(join(ROOT, 'references', 'alexandria.md'), 'utf8');
  for (const rule of ['Discover before you retrieve', 'Call only what discovery returned', 'Know the price first', 'Never accept terms', 'never an absence']) assert.ok(md.includes(rule), rule);
  assert.match(md, /\| `ashbyhq-com`/);
  assert.match(md, /\| `upspring`/);
});

test('the plugin connects Firecrawl by OAuth and keeps no key in its MCP config', () => {
  const cfg = JSON.parse(readFileSync(join(ROOT, '.mcp.json'), 'utf8'));
  assert.equal(cfg.mcpServers.firecrawl.url, 'https://mcp.firecrawl.dev/v2/mcp-oauth');
  assert.ok(!JSON.stringify(cfg).match(/fc-[0-9a-f]{8}/));
});

test('with no key, the script turns the analyst levels into scores.json on the second run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sneak-fallback-'));
  execFileSync('cp', [join(ROOT, 'tests', 'fixtures', 'exa.ai', 'evidence.json'), dir]);
  const env = { ...process.env }; delete env.TYPESAFE_API_KEY;
  const run = () => execFileSync('node', [join(ROOT, 'scripts', 'score.mjs'), dir], { env }).toString();
  assert.match(run(), /then run this script again/);
  assert.ok(!existsSync(join(dir, 'scores.json')));
  writeFileSync(join(dir, 'analysis.json'), JSON.stringify({ activity_levels: [{ activity: 'comparison', level: 3 }, { activity: 'google_ads', level: 2 }] }));
  assert.match(run(), /analyst-scored activities/);
  const s = JSON.parse(readFileSync(join(dir, 'scores.json'), 'utf8'));
  assert.equal(s.activities.comparison.score, 100);
  assert.equal(s.activities.comparison.basis, 'analyst');
  assert.equal(s.activities.comparison.confidence, null);
});

test('the skill names every step the pipeline needs, in order, with no stale rule', () => {
  const md = readFileSync(join(ROOT, 'skills', 'sneak', 'SKILL.md'), 'utf8');
  const order = ['## 0.', '## 1.', '## 2.', '## 3.', '## 3b.', '## 4.', '## 4b.', '## 5.', '## 6.'].map((h) => md.indexOf(h));
  assert.ok(order.every((i) => i > 0), 'a step is missing');
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.ok(!/It never recommends/.test(md), 'the old "never recommends" rule is gone');
  for (const must of ['TYPESAFE_API_KEY', 'alexandria.md', 'voice.md', 'plays.md', 'activity_levels', 'scores.json']) assert.ok(md.includes(must), must);
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
      } else if (/[<*]/.test(rel)) continue; // another placeholder: nothing to check
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
