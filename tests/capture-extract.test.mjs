// The verbatim path: hook saves tool responses untouched, extractors map them by code, merge checks them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startRun, stopRun, activeRun, capture } from '../scripts/capture.mjs';
import { extractAll, writeAuto } from '../scripts/extract.mjs';
import { mergeDir } from '../scripts/merge.mjs';
import { parseExaResults, postText } from '../scripts/extract/exa.mjs';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const tmp = () => mkdtempSync(join(tmpdir(), 'gs-cap-'));

// Text returned by Exa's web_search_exa on 2026-10-27 (shortened). The first result shows engagement, the second does not.
const EXA_TEXT = `Title: Introducing Exa 3.0, a step change in search for agents.
URL: https://www.linkedin.com/posts/exa-ai_introducing-exa-30-a-step-change-in-search-activity-7517984537654644736-GjLc
Published: 2026-10-19T00:00:00.000Z
Author: Exa
Highlights:
# Introducing Exa 3.0, a step change in search for agents. | Exa · LinkedIn · 2026-10-19T00:00:00+00:00

**Exa**.

---

Introducing Exa 3.0, a step change in search for agents.

Exa 3.0 led on every benchmark we tested, from public research evals to coding and GTM intelligence.

We are also launching Exa Lite at $4 per 1,000 requests for cost-sensitive apps.

Introducing Exa 3.0, a step change in search for agents. | Exa image

...

## Engagement

- Reactions: 339
- Comments: 24

---

Title: Exa’s Post
URL: https://www.linkedin.com/posts/exa-ai_weve-been-working-on-ai-powered-search-since-activity-7219489461221343232-SLy4
Published: 2024-07-17T00:00:00.000Z
Author: Exa
Highlights:
We’ve been working on AI-powered search since before ChatGPT (2021). Join us!`;

const envelope = (text) => ({ content: [{ type: 'text', text }] });
const x = (id, text, likes, reposts, replies, at = '2026-10-19T16:32:53Z') => ({ id, text, created_at: at, likes, reposts, replies });

function setup({ calls = [], social = null } = {}) {
  const dir = tmp();
  mkdirSync(join(dir, 'raw', 'calls'), { recursive: true });
  mkdirSync(join(dir, 'fragments'));
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ domain: 'exa.ai', brand: 'Exa', captured_at: '2026-10-27T10:00:00Z', sources: {} }));
  if (social) writeFileSync(join(dir, 'raw', 'social.json'), JSON.stringify(social));
  calls.forEach((c, i) => capture({ tool_name: c.tool, tool_use_id: `t${i}`, tool_input: c.input, tool_response: c.response }, dir));
  return dir;
}
const alexCall = (provider, capability, options, records) => ({
  tool: 'mcp__plugin_growth-sneak_firecrawl__firecrawl_scrape',
  input: { objective: 'x', alexandria: [{ provider, capability, options }] },
  response: envelope(JSON.stringify({ data: { alexandria: [{ provider, capability, records }] } })),
});

test('capture: a hook call is saved exactly as received, and only while a run is active', () => {
  const base = tmp();
  const response = envelope('{"keep":"every  space\\nand 363 vs 339"}');
  const hook = (cwd) => spawnSync('node', [join(ROOT, 'scripts', 'capture.mjs')], { input: JSON.stringify({ cwd, tool_name: 'mcp__plugin_growth-sneak_exa__web_search_exa', tool_use_id: 'abc', tool_input: { query: 'q' }, tool_response: response }), encoding: 'utf8' });
  assert.equal(hook(base).status, 0);
  assert.equal(activeRun([base]), null, 'no run marked: nothing saved');
  const dir = startRun(join(base, 'reports', 'exa.ai'), base);
  const r = hook(base);
  assert.equal(r.status, 0); assert.equal(r.stdout, '', 'the hook prints nothing');
  const files = readdirSync(join(dir, 'raw', 'calls'));
  assert.equal(files.length, 1);
  const saved = JSON.parse(readFileSync(join(dir, 'raw', 'calls', files[0]), 'utf8'));
  assert.deepEqual(saved.response, response, 'the response is stored untouched');
  assert.deepEqual(saved.tool_input, { query: 'q' });
  stopRun(base);
  assert.equal(activeRun([base]), null);
  assert.equal(spawnSync('node', [join(ROOT, 'scripts', 'capture.mjs')], { input: 'not json', encoding: 'utf8' }).status, 0, 'a bad payload never breaks the tool call');
});

test('hooks.json: registered for Firecrawl and Exa tools, including plugin-scoped names', () => {
  const h = JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks.PostToolUse[0];
  const re = new RegExp(h.matcher);
  for (const t of ['mcp__plugin_growth-sneak_firecrawl__firecrawl_scrape', 'mcp__plugin_growth-sneak_exa__web_search_exa', 'mcp__firecrawl__firecrawl_search']) assert.ok(re.test(t), t);
  for (const t of ['Bash', 'Read', 'mcp__github__search']) assert.ok(!re.test(t), t);
  assert.match(h.hooks[0].command, /\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/capture\.mjs/);
});

test('exa: result blocks, engagement counts and the post text are read exactly as shown', () => {
  const b = parseExaResults(EXA_TEXT);
  assert.equal(b.length, 2);
  assert.deepEqual(b[0].engagement, { reactions: 339, comments: 24 });
  assert.deepEqual(b[1].engagement, {});
  assert.equal(b[0].published, '2026-10-19T00:00:00.000Z');
  const t = postText(b[0].raw);
  assert.match(t, /^Introducing Exa 3\.0, a step change in search for agents\./);
  assert.ok(t.includes('Exa Lite at $4 per 1,000 requests'));
  assert.ok(!/Reactions|image$|^# /m.test(t), 'no page title, caption or engagement list in the text');
});

test('extract: LinkedIn posts carry the counts the page showed, and none where it showed none', () => {
  const dir = setup({ calls: [{ tool: 'mcp__plugin_growth-sneak_exa__web_search_exa', input: { query: 'exa linkedin' }, response: envelope(EXA_TEXT) }], social: { domain: 'exa.ai', accounts: [{ platform: 'linkedin', handle: 'company/exa-ai', url: 'https://www.linkedin.com/company/exa-ai/' }] } });
  const { fragments, report } = extractAll(dir);
  const social = fragments.find((f) => f.layer === 'social');
  assert.equal(social.posts.length, 1, 'the 2024 post is outside the 120-day window');
  assert.deepEqual(social.posts[0].metrics, { reactions: 339, comments: 24 });
  assert.equal(social.posts[0].owner, 'company');
  assert.match(social.posts[0].raw_ref, /^calls\/.+\.json#exa:0$/);
  assert.equal(report.extracted.linkedin_posts, 1);
  assert.equal(report.outside_window.posts.length, 1, 'and it is listed, not silently lost');
  assert.equal(report.outside_window.posts[0].published, '2024-07-17');
});

test('extract: X posts, Google ads and pricing are mapped from saved responses, never invented', () => {
  const dir = setup({ calls: [
    alexCall('x-com', 'users/posts', { username: 'ExaAILabs', limit: 10 }, [x('111', 'Exa 3.0 is live', 40, 1, 0), x('112', 'Exa Lite at $4/1k', 78, 0, 2, '2026-10-18T10:00:00Z'), { id: '113', text: 'no date' }]),
    alexCall('adstransparency-google-com', 'ad-transparency/list_ads', { advertiser_id: 'AR123' }, [{ creative_id: 'CR1', format: 'TEXT', days_shown: 8, first_shown: '2026-10-12', last_shown: '2026-10-26', width: 348, height: 134 }]),
    { tool: 'mcp__plugin_growth-sneak_firecrawl__firecrawl_scrape', input: { url: 'https://exa.ai/pricing', formats: ['json'] }, response: envelope(JSON.stringify({ json: { billing_shown: null, plans: [{ name: 'Starter', price: 'Free', unit: '$10 credits per month', key_points: ['MCP server'] }, { name: 'Enterprise', price: 'Custom' }], add_ons: ['Search from $4/1k requests'] } })) },
  ], social: { domain: 'exa.ai', accounts: [{ platform: 'x', handle: 'exaailabs', url: 'https://x.com/exaailabs' }] } });
  const { fragments, report } = extractAll(dir);
  const by = (l) => fragments.find((f) => f.layer === l);
  const posts = by('social').posts;
  assert.deepEqual(posts.map((p) => p.url), ['https://x.com/ExaAILabs/status/111', 'https://x.com/ExaAILabs/status/112']);
  assert.deepEqual(posts[0].metrics, { likes: 40, reposts: 1, replies: 0 });
  assert.equal(posts[0].owner, 'company');
  assert.equal(report.skipped.length, 1, 'the record with no date is skipped and reported');
  assert.match(report.skipped[0].why, /missing its id, text or date/);
  assert.match(by('social').items.find((i) => i.ref === 'auto-x-exaailabs').finding, /^A 2-post sample of @ExaAILabs on X \(18 Oct 2026 to 19 Oct 2026\)/);
  const ad = by('paid').ads[0];
  assert.equal(ad.url, 'https://adstransparency.google.com/advertiser/AR123/creative/CR1?region=anywhere');
  assert.equal(ad.days_shown, 8); assert.equal(ad.days_shown_basis, undefined, 'the provider gave the number');
  assert.equal(ad.headline, undefined, 'no headline in the data, so none is written');
  assert.deepEqual(by('owned').pricing.plans.map((p) => p.name), ['Starter', 'Enterprise']);
});

test('end to end: capture, extract, merge and the renderer checks accept the machine-made ledger', () => {
  const dir = setup({ calls: [alexCall('x-com', 'users/posts', { username: 'WilliamBryk' }, [x('9', 'Agents do not search like humans.', 2118, 156, 91)])] });
  writeFileSync(join(dir, 'judgments.json'), '{}');
  mkdirSync(join(dir, 'judgments')); writeFileSync(join(dir, 'judgments', 'social.json'), JSON.stringify({ owners: { williambryk: 'founder' }, kinds: { 'https://x.com/WilliamBryk/status/9': 'research' } }));
  writeAuto(dir);
  assert.ok(existsSync(join(dir, 'fragments', 'social.auto.json')));
  const r = mergeDir(dir);
  const ev = JSON.parse(readFileSync(join(dir, 'evidence.json'), 'utf8'));
  assert.equal(ev.posts.length, 1);
  assert.equal(ev.posts[0].owner, 'founder'); assert.equal(ev.posts[0].kind, 'research');
  assert.deepEqual(ev.posts[0].metrics, { likes: 2118, reposts: 156, replies: 91 });
  assert.ok(ev.posts[0].evidence_id && ev.posts[0].raw_ref);
  assert.equal(r.provenance.verified.posts, 1);
});

test('merge: with capture active, hand-written posts and ads are set aside; ones with a raw_ref are checked', () => {
  const dir = setup({ calls: [alexCall('x-com', 'users/posts', { username: 'ExaAILabs' }, [x('111', 'Exa 3.0 is live', 40, 1, 0)])], social: { domain: 'exa.ai', accounts: [{ platform: 'x', handle: 'exaailabs', url: 'https://x.com/exaailabs' }] } });
  writeAuto(dir);
  const item = { ref: 'm1', channel: 'social', status: 'observed', finding: 'A note.', url: 'https://x.com/ExaAILabs' };
  writeFileSync(join(dir, 'fragments', 'social.json'), JSON.stringify({ layer: 'social', items: [item], posts: [{ platform: 'x', account: 'ExaAILabs', owner: 'company', url: 'https://x.com/ExaAILabs/status/777', published: '2026-10-10', text: 'Remembered by a model', metrics: { likes: 363 }, evidence_ref: 'm1' }] }));
  const r = mergeDir(dir);
  const ev = JSON.parse(readFileSync(join(dir, 'evidence.json'), 'utf8'));
  assert.deepEqual(ev.posts.map((p) => p.url), ['https://x.com/ExaAILabs/status/111'], 'only the extracted post is shown');
  assert.equal(r.provenance.dropped.length, 1);
  assert.match(r.provenance.dropped[0].why, /no raw_ref/);
});

test('merge: a count that is not in the saved response fails the build', () => {
  const dir = setup({ calls: [alexCall('x-com', 'users/posts', { username: 'ExaAILabs' }, [x('111', 'Exa 3.0 is live', 40, 1, 0)])] });
  writeAuto(dir);
  const f = join(dir, 'fragments', 'social.auto.json');
  const j = JSON.parse(readFileSync(f, 'utf8')); j.posts[0].metrics.likes = 363; writeFileSync(f, JSON.stringify(j));
  assert.throws(() => mergeDir(dir), /likes=363/);
  const j2 = JSON.parse(readFileSync(f, 'utf8')); j2.posts[0].metrics.likes = 40; j2.posts[0].text = 'Exa 3.0 is live today'; writeFileSync(f, JSON.stringify(j2));
  assert.throws(() => mergeDir(dir), /not found in calls/);
  const j3 = JSON.parse(readFileSync(f, 'utf8')); j3.posts[0].text = 'Exa 3.0 is live'; j3.posts[0].raw_ref = 'calls/missing.json'; writeFileSync(f, JSON.stringify(j3));
  assert.throws(() => mergeDir(dir), /captured call that does not exist/);
});

test('merge: a hand-written item that cites a file gets a warning when its numbers are not in that file', () => {
  const dir = setup({ calls: [{ tool: 'mcp__plugin_growth-sneak_exa__web_search_exa', input: { query: 'q' }, response: envelope(EXA_TEXT) }] });
  const file = readdirSync(join(dir, 'raw', 'calls'))[0];
  writeAuto(dir);
  writeFileSync(join(dir, 'fragments', 'social.json'), JSON.stringify({ layer: 'social', items: [{ ref: 'm1', channel: 'social', status: 'observed', finding: 'The Exa 3.0 post has 363 reactions.', url: 'https://x.com/ExaAILabs', cites: [`calls/${file}`] }] }));
  const r = mergeDir(dir);
  assert.ok(r.provenance.warnings.some((w) => /363/.test(w)), 'the 363 that the page does not show is flagged');
});

test('runs without any captured calls behave as before', () => {
  const dir = setup();
  writeFileSync(join(dir, 'fragments', 'social.json'), JSON.stringify({ layer: 'social', items: [{ ref: 'm1', channel: 'social', status: 'observed', finding: 'A note.', url: 'https://x.com/a' }], posts: [{ platform: 'x', account: 'a', owner: 'company', url: 'https://x.com/a/status/1', published: '2026-10-10', text: 't', evidence_ref: 'm1' }] }));
  const r = mergeDir(dir);
  assert.equal(r.provenance, undefined);
  assert.equal(JSON.parse(readFileSync(join(dir, 'evidence.json'), 'utf8')).posts.length, 1);
});

test('instructions: the skill starts capture and extracts before merging; collectors are told not to hand-write the data', () => {
  const skill = readFileSync(join(ROOT, 'skills', 'sneak', 'SKILL.md'), 'utf8');
  for (const must of ['capture.mjs" --start', 'capture.mjs" --stop', 'extract.mjs" "$R"', '## 2b. Extract', 'extract-report.json', 'judgments']) assert.ok(skill.includes(must), must);
  assert.ok(skill.indexOf('## 2b. Extract') < skill.indexOf('## 3. Merge'), 'extract runs before merge');
  const agent = readFileSync(join(ROOT, 'agents', 'sneak-collector.md'), 'utf8');
  for (const must of ['Do not write `posts`, `ads`', '`cites`', 'judgments/<layer>.json']) assert.ok(agent.includes(must), must);
  const fmt = readFileSync(join(ROOT, 'references', 'data-format.md'), 'utf8');
  for (const must of ['raw_ref', 'provenance.dropped', 'days_shown_basis']) assert.ok(fmt.includes(must), must);
});

test('merge: auto blocks from the free scripts never cause hand-written posts to be dropped when no call was captured', () => {
  const dir = setup({ social: { domain: 'exa.ai', accounts: [{ platform: 'x', handle: 'a', url: 'https://x.com/a' }], discord: { name: 'Exa', members: 5, invite: 'x' } } });
  writeAuto(dir);
  assert.ok(existsSync(join(dir, 'fragments', 'social.auto.json')), 'script blocks were built');
  writeFileSync(join(dir, 'fragments', 'social.json'), JSON.stringify({ layer: 'social', items: [{ ref: 'm1', channel: 'social', status: 'observed', finding: 'A note.', url: 'https://x.com/a' }], posts: [{ platform: 'x', account: 'a', owner: 'company', url: 'https://x.com/a/status/1', published: '2026-10-10', text: 't', evidence_ref: 'm1' }] }));
  const r = mergeDir(dir);
  assert.equal(JSON.parse(readFileSync(join(dir, 'evidence.json'), 'utf8')).posts.length, 1, 'the post is kept');
  assert.equal(r.provenance.capture_active, false);
  assert.equal(r.provenance.dropped.length, 0);
});

// ---- shapes captured from a live run on 2026-10-27 (the hook hands over the tool response as a JSON string) ----
const live = (provider, capability, options, result) => ({
  tool: 'mcp__plugin_growth-sneak_firecrawl__firecrawl_scrape',
  input: { objective: 'x', alexandria: [{ provider, capability, options }] },
  response: JSON.stringify({ success: true, data: { alexandria: [{ provider, capability, ...result }] } }),
});
const liveX = (id, text, like, repost, reply, at) => ({ id, username: 'WilliamBryk', url: `https://x.com/WilliamBryk/status/${id}`, text, name: 'Will Bryk', description: 'ceo @exaailabs', created_at: at, public_metrics: { like_count: like, repost_count: repost, reply_count: reply } });
const liveAd = (cid, format, days, first, last, preview) => ({ advertiser_id: 'AR1', advertiser_name: 'Exa AI Labs', creative_id: cid, days_shown: days, domain: 'exa.ai', first_shown_at: first, first_shown_unix: 1, format, format_code: 1, impressions_high: null, impressions_low: null, last_shown_at: last, last_shown_unix: 2, preview, regions: null, spend_high: null, spend_low: null, url: `https://adstransparency.google.com/advertiser/AR1/creative/${cid}?region=anywhere` });

test('live shape: X counts sit under public_metrics and are read from there', () => {
  const dir = setup({ calls: [live('x-com', 'users/posts', { username: 'WilliamBryk', limit: 10 }, { data: { data: [liveX('2112286651787641135', 'Around 500,000 B200 GPU-hours were used for making this.', 218, 5, 24, '2026-10-19T20:55:56.000Z')], meta: { citations: [] } }, records: 1 })] });
  const { fragments } = extractAll(dir);
  const p = fragments.find((f) => f.layer === 'social').posts[0];
  assert.deepEqual(p.metrics, { likes: 218, reposts: 5, replies: 24 }, 'likes, reposts and replies come from public_metrics');
  assert.equal(p.published, '2026-10-19');
  writeAuto(dir); assert.equal(mergeDir(dir).provenance.verified.posts, 1, 'and the counts verify against the saved response');
});

test('live shape: Google ads use the provider total, the preview image and size, and first/last_shown_at', () => {
  const page = (ads, count) => ({ data: { ads, advertiser_id: null, continuation: null, count, domain: 'exa.ai', region: 'anywhere', total_low: 3, total_high: 3 }, records: count });
  const dir = setup({ calls: [live('adstransparency-google-com', 'ad-transparency/list_ads', { domain: 'exa.ai', limit: 40 }, page([
    liveAd('CR1', 'TEXT', 25, '2026-10-01T19:34:04Z', '2026-10-27T17:58:41Z', { height: 483, image_html: '<img>', image_url: 'https://tpc.googlesyndication.com/archive/simgad/1', kind: 'image', preview_url: null, width: 348 }),
    liveAd('CR2', 'IMAGE', 31, '2025-10-20T09:50:20Z', '2025-11-25T06:52:26Z', { height: 511, image_url: 'https://tpc.googlesyndication.com/archive/simgad/2', kind: 'image', width: 724 }),
    liveAd('CR3', 'VIDEO', 37, '2025-10-06T18:42:35Z', '2025-11-25T02:46:29Z', { height: null, image_url: null, kind: 'rendered', preview_url: 'https://displayads-formats.googleusercontent.com/ads/preview/content.js?x=1', width: null }),
  ], 3))] });
  const paid = extractAll(dir).fragments.find((f) => f.layer === 'paid');
  assert.deepEqual(paid.ads_total, { low: 3, high: 3 }, 'total_low/high, not the page size');
  const [a, b, c] = paid.ads;
  assert.equal(a.image_url, 'https://tpc.googlesyndication.com/archive/simgad/1'); assert.equal(a.width, 348); assert.equal(a.height, 483);
  assert.equal(a.first_shown, '2026-10-01'); assert.equal(a.last_shown, '2026-10-27'); assert.equal(a.days_shown, 25); assert.equal(a.days_shown_basis, undefined);
  assert.equal(c.image_url, null, 'a video preview_url is a player page, not a picture');
  assert.equal(b.format, 'image');
  assert.match(paid.items.find((i) => i.ref === 'auto-google-total').finding, /lists 3 ads/);
  const sample = paid.items.find((i) => i.ref === 'auto-google-sample').finding;
  assert.match(sample, /^All 3 ads Google lists were retrieved; 1 last shown within 2 days of the capture date; 1 search \(text\), 1 image, 1 video\./);
});

test('live shape: an Exa result with "Author: N/A" and no account in its URL is not attributed to anyone', () => {
  const text = `Title: Agent search is easy to demo and hard to evaluate.
URL: https://www.linkedin.com/feed/update/urn:li:activity:7513267462105104384
Published: 2026-10-06T00:00:00.000Z
Author: N/A
Highlights:
Agent search is easy to demo and hard to evaluate.

Peter Deng and I sat down with Exa co-founder Will Bryk.`;
  const dir = setup({ calls: [{ tool: 'mcp__plugin_growth-sneak_exa__web_search_exa', input: { query: 'q' }, response: text }] });
  const { fragments, report } = extractAll(dir);
  assert.equal(fragments.find((f) => f.layer === 'social')?.posts?.length ?? 0, 0);
  assert.match(report.skipped[0].why, /no account/);
});

test('extract report: provider fields no mapping reads are listed, so a gap cannot hide', () => {
  const rec = { ...liveX('9', 'A post.', 1, 2, 3, '2026-10-19T00:00:00Z'), quote_count: 4, lang: 'en' };
  const dir = setup({ calls: [live('x-com', 'users/posts', { username: 'WilliamBryk' }, { data: { data: [rec] }, records: 1 })] });
  assert.deepEqual(extractAll(dir).report.unmapped_fields.x_posts, ['lang', 'quote_count']);
  const clean = setup({ calls: [live('x-com', 'users/posts', { username: 'WilliamBryk' }, { data: { data: [liveX('9', 'A post.', 1, 2, 3, '2026-10-19T00:00:00Z')] }, records: 1 })] });
  assert.equal(extractAll(clean).report.unmapped_fields.x_posts, undefined);
});

test('verify: numbers in a cited free-script file are found, and years and "90 days" are not treated as data', () => {
  const dir = setup({ social: { domain: 'exa.ai', accounts: [], discord: { name: 'Exa', members: 5059, online: 310, invite: 'x' } } });
  writeFileSync(join(dir, 'fragments', 'social.json'), JSON.stringify({ layer: 'social', items: [
    { ref: 'ok', channel: 'community', status: 'observed', finding: 'The Discord has 5,059 members, checked on 27 Oct 2026, 90 days after launch.', url: 'https://discord.gg/x', cites: ['raw/social.json'] },
    { ref: 'bad', channel: 'community', status: 'observed', finding: 'The Discord has 7,777 members.', url: 'https://discord.gg/x', cites: ['raw/social.json'] },
  ] }));
  writeAuto(dir);
  const w = mergeDir(dir).provenance.warnings;
  assert.equal(w.length, 1, 'only the number that is not in the file is flagged');
  assert.match(w[0], /7777/);
});

test('verify: a saved call can be cited as raw/calls/<file> or calls/<file>', () => {
  const dir = setup({ calls: [{ tool: 'mcp__plugin_growth-sneak_exa__web_search_exa', input: { query: 'q' }, response: EXA_TEXT }] });
  const file = readdirSync(join(dir, 'raw', 'calls'))[0];
  writeAuto(dir);
  writeFileSync(join(dir, 'fragments', 'social.json'), JSON.stringify({ layer: 'social', items: [
    { ref: 'a', channel: 'social', status: 'observed', finding: 'The post has 339 reactions.', url: 'https://x.com/a', cites: [`raw/calls/${file}`] },
    { ref: 'b', channel: 'social', status: 'observed', finding: 'The post has 24 comments.', url: 'https://x.com/a', cites: [`calls/${file}`] },
  ] }));
  assert.deepEqual(mergeDir(dir).provenance.warnings, []);
});
