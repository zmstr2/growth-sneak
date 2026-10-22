import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, utimesSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderReport } from '../scripts/render.mjs';
import { normalizeMetrics } from '../scripts/social.mjs';
import { digestFor, analysisIsStale } from '../scripts/score.mjs';
import { run as sitecheck } from '../scripts/sitecheck.mjs';
import { merge, mergeDir } from '../scripts/merge.mjs';
import { pickPlays, scoreRows } from '../scripts/scoreboard.mjs';
import { ACTIVITIES } from '../scripts/rubric.mjs';
import { allScores, paneOf, stripOf, stripItems, sectionOf } from './helpers.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'exa.ai');
const load = () => ({
  evidence: JSON.parse(readFileSync(join(FIX, 'evidence.json'), 'utf8')),
  analysis: JSON.parse(readFileSync(join(FIX, 'analysis.json'), 'utf8')),
});
const render = (ev, an, scores = allScores(ev)) => renderReport(ev, an, { baseDir: FIX, scores });
const act = (id) => ACTIVITIES.find((a) => a.id === id);
const sc = (score, confidence = 0.9, basis = 'jev', ev = ['E001']) => ({ score, confidence, basis, evidence_ids: ev });

// ---------- normalizeMetrics ----------

test('normalizeMetrics: LinkedIn likes/replies/shares become reactions/comments/reposts', () => {
  assert.deepEqual(normalizeMetrics('linkedin', { likes: 10, replies: 2, shares: 3 }), { reactions: 10, comments: 2, reposts: 3 });
  assert.deepEqual(normalizeMetrics('linkedin', { reactions: 4, likes: 6 }), { reactions: 10 }, 'aliases add to the real key');
});
test('normalizeMetrics: keys a platform lacks are dropped, never invented', () => {
  assert.deepEqual(normalizeMetrics('linkedin', { reactions: 5, views: 900, retweets: 7 }), { reactions: 5 });
  assert.deepEqual(normalizeMetrics('x', { likes: 5, bogus: 1, reposts: 2 }), { likes: 5, reposts: 2 });
  assert.deepEqual(normalizeMetrics('x', { likes: NaN, reposts: null }), {}, 'non-numbers are dropped, not zeroed');
});
test('normalizeMetrics: hn and reddit likes become points; non-objects pass through', () => {
  assert.deepEqual(normalizeMetrics('hn', { likes: 120, comments: 30 }), { points: 120, comments: 30 });
  assert.deepEqual(normalizeMetrics('reddit', { likes: 9 }), { points: 9 });
  assert.equal(normalizeMetrics('x', undefined), undefined);
});
test('merge normalises post metrics', () => {
  const run = { domain: 'x.test', captured_at: '2026-10-20T00:00:00Z' };
  const item = { ref: 's1', channel: 'organic_social', status: 'observed', finding: 'f', url: 'https://x.test/' };
  const { evidence } = merge(run, [{ layer: 'social', items: [item], posts: [{ platform: 'linkedin', owner: 'company', account: 'a', published: '2026-10-01', url: 'https://www.linkedin.com/x', text: 't', metrics: { likes: 5, replies: 1, views: 99 }, evidence_ref: 's1' }] }]);
  assert.deepEqual(evidence.posts[0].metrics, { reactions: 5, comments: 1 });
});

// ---------- digest citations and zero counts ----------

test('digest: lines from structured blocks cite the block\'s evidence id and add it to ids', () => {
  const ev = { items: [{ id: 'E007', channel: 'seo_content', status: 'observed', finding: 'Sitemap read.', url: 'https://x.test/' }], site: { evidence_id: 'E007', total_urls: 50, sections: [{ path: '/blog', urls: 40 }] } };
  const d = digestFor(act('seo_content'), ev);
  assert.ok(d.lines.some((l) => /^E007: Site: 50 English pages/.test(l)));
  assert.ok(d.lines.every((l) => /^E\d+: /.test(l)));
  assert.deepEqual(d.ids, ['E007']);
  const ev2 = { items: [], site: { evidence_id: 'E009', total_urls: 5, sections: [] } };
  assert.deepEqual(digestFor(act('seo_content'), ev2).ids, ['E009'], 'cited via the block even with no fact item');
});
test('digest: a block with no evidence id contributes no line', () => {
  const d = digestFor(act('seo_content'), { items: [], site: { total_urls: 50, sections: [] } });
  assert.deepEqual(d.lines, []);
});
test('digest: counts of zero are never sent as evidence', () => {
  const zero = { evidence_id: 'E001', page_types: { comparison: { urls: 0 }, customers: { urls: 0 }, integrations: { urls: 0 } } };
  const ev = { items: [], site: zero, community: { discord: { evidence_id: 'E002', members: 0 }, hacker_news: { evidence_id: 'E003', stories: 0 } }, oss: { evidence_id: 'E004', repos: 0 } };
  for (const id of ['comparison', 'customer_proof', 'partnerships', 'community', 'open_source']) assert.deepEqual(digestFor(act(id), ev).lines, [], id);
  const some = { items: [], site: { evidence_id: 'E001', page_types: { comparison: { urls: 3 } } } };
  assert.match(digestFor(act('comparison'), some).lines[0], /^E001: 3 comparison-type URLs/);
});
test('digest: engagement uses the platform formula, unmeasured posts say not visible, replies are excluded', () => {
  const post = (o) => ({ platform: 'linkedin', owner: 'company', published: '2026-10-01', evidence_id: 'E001', ...o });
  const ev = { items: [], posts: [post({ metrics: { reactions: 10, comments: 5 } }), post({ metrics: { reactions: 3 } }), post({ reply: true, metrics: { reactions: 999 } })] };
  const l = digestFor(act('organic_social'), ev).lines[0];
  assert.match(l, /^E001: 2 company posts/);
  assert.match(l, /15, 3\./);
  assert.ok(!/999/.test(l));
  const none = digestFor(act('organic_social'), { items: [], posts: [post({})] }).lines[0];
  assert.match(none, /engagement not visible/);
});
test('digest: the google_ads line counts only the company\'s own ads', () => {
  const ev = { items: [{ id: 'E001', channel: 'google_ads', status: 'observed', finding: 'ads', url: 'https://x.test/' }], ads: [{ days_shown: 10 }, { days_shown: 5, own: false }, { days_shown: 7, own: true }] };
  const line = digestFor(act('google_ads'), ev).lines.find((l) => /own ads/.test(l));
  assert.match(line, /^E001: 2 of the company's own ads collected; days shown: 10, 7\./);
  const onlyOthers = digestFor(act('google_ads'), { ...ev, ads: [{ days_shown: 5, own: false }] }).lines;
  assert.ok(!onlyOthers.some((l) => /own ads/.test(l)));
});

// ---------- stale analysis guard ----------

test('analysisIsStale: an analysis.json older than evidence.json is stale', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gs-stale-'));
  const a = join(dir, 'analysis.json'), e = join(dir, 'evidence.json');
  writeFileSync(a, '{}'); writeFileSync(e, '{}');
  utimesSync(a, 1000, 1000); utimesSync(e, 2000, 2000);
  assert.equal(analysisIsStale(a, e), true);
  utimesSync(a, 3000, 3000);
  assert.equal(analysisIsStale(a, e), false);
});

// ---------- sitecheck: 404 vs 403 vs 200 ----------

const HOME = `<html><head><title>T</title></head><body>${'word '.repeat(200)}</body></html>`;
async function withFetch(map, fn) {
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    const path = new URL(url).pathname;
    const r = map[path];
    if (r === 'throw') throw new Error('network down');
    const { status, body = '', type = 'text/plain' } = r ?? { status: 404 };
    return { status, ok: status < 400, headers: { get: () => type }, text: async () => body };
  };
  try { return await fn(seen); } finally { globalThis.fetch = real; }
}
const row = (r, check) => r.checks.find((c) => c.check === check);

test('sitecheck: robots.txt 200 is read, with pluralised counts', async () => {
  const r = await withFetch({ '/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /a\nSitemap: https://x.test/s.xml\n' }, '/llms.txt': { status: 200, body: 'a\nb' }, '/': { status: 200, body: HOME, type: 'text/html' } }, () => sitecheck('x.test'));
  assert.equal(row(r, 'robots.txt').result, 'yes');
  assert.equal(row(r, 'robots.txt').detail, '1 rule group, 1 sitemap declared');
  assert.equal(row(r, 'llms.txt').result, 'yes');
});
test('sitecheck: robots.txt 404 means missing (no), and every crawler is computed as allowed', async () => {
  const r = await withFetch({ '/llms.txt': { status: 404 }, '/': { status: 200, body: HOME } }, () => sitecheck('x.test'));
  assert.equal(row(r, 'robots.txt').result, 'no');
  assert.equal(row(r, 'robots.txt').detail, 'No robots.txt (every crawler is allowed by default)');
  assert.equal(row(r, 'AI crawlers blocked').result, 'no');
  assert.equal(row(r, 'AI crawlers allowed').result, 'yes');
  assert.equal(row(r, 'llms.txt').result, 'no');
});
test('sitecheck: robots.txt 403, 500 or a network failure is unknown, never a no; llms.txt likewise', async () => {
  for (const bad of [{ status: 403 }, { status: 500 }, 'throw']) {
    const r = await withFetch({ '/robots.txt': bad, '/llms.txt': bad, '/': bad }, () => sitecheck('x.test'));
    assert.equal(row(r, 'robots.txt').result, 'unknown');
    assert.equal(row(r, 'llms.txt').result, 'unknown');
    assert.equal(row(r, 'Homepage readable without JavaScript').result, 'unknown');
    assert.equal(row(r, 'AI crawlers blocked'), undefined, 'no crawler rows without a robots.txt answer');
  }
});
test('sitecheck: the homepage is fetched at the given host, with no www forced', async () => {
  await withFetch({ '/': { status: 200, body: HOME } }, async (seen) => {
    await sitecheck('https://app.x.test/path');
    assert.ok(seen.every((u) => u.startsWith('https://app.x.test/')), seen.join(' '));
    assert.ok(seen.includes('https://app.x.test/'));
  });
});

// ---------- merge ----------

const mrun = { domain: 'x.test', captured_at: '2026-10-20T00:00:00Z' };
const mitem = (ref, channel = 'seo_content') => ({ ref, channel, status: 'observed', finding: 'f', url: 'https://x.test/' });

test('merge keeps ids stable from a previous merge, and new items take the next free id', () => {
  const first = merge(mrun, [{ layer: 'owned', items: [mitem('a'), mitem('b')] }]);
  assert.deepEqual(first.ids, { a: 'E001', b: 'E002' });
  const second = merge(mrun, [{ layer: 'paid', items: [mitem('n', 'google_ads')] }, { layer: 'owned', items: [mitem('b'), mitem('a')] }], first.ids);
  assert.deepEqual(second.ids, { n: 'E003', a: 'E001', b: 'E002' });
  assert.deepEqual(second.evidence.items.map((i) => i.id).sort(), ['E001', 'E002', 'E003']);
});
test('merge sums fragment credits into cost.firecrawl_credits, ignoring non-numbers', () => {
  const { evidence } = merge({ ...mrun, cost: { exa: 2 } }, [{ layer: 'owned', credits: 12, items: [mitem('a')] }, { layer: 'paid', credits: 30, items: [] }, { layer: 'social', credits: 'lots', items: [] }]);
  assert.equal(evidence.cost.firecrawl_credits, 42);
  assert.equal(evidence.cost.exa, 2);
  assert.equal(merge(mrun, [{ layer: 'owned', items: [] }]).evidence.cost.firecrawl_credits, 0);
});
test('merge throws when two layers write the same single block', () => {
  for (const [k, v] of [['site', { sections: [] }], ['pricing', { plans: [] }], ['traffic', { points: [] }], ['meta_ads', { ads: [] }], ['oss', { repos: 1 }], ['tech', { tools: [] }], ['site_checks', { checks: [] }]]) {
    assert.throws(() => merge(mrun, [{ layer: 'owned', items: [], [k]: v }, { layer: 'company', items: [], [k]: v }]), new RegExp(`"${k}" is written by both`), k);
  }
});
test('merge: the retired roles and journey keys are rejected', () => {
  assert.throws(() => merge(mrun, [{ layer: 'company', items: [], roles: {} }]), /unknown key "roles"/);
  assert.throws(() => merge(mrun, [{ layer: 'owned', items: [], journey: [] }]), /unknown key "journey"/);
});
test('mergeDir validates the merged evidence before writing it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gs-merge-'));
  mkdirSync(join(dir, 'fragments'));
  writeFileSync(join(dir, 'run.json'), JSON.stringify(mrun));
  const bad = { ...mitem('a'), url: 'javascript:alert(1)' };
  writeFileSync(join(dir, 'fragments', 'owned.json'), JSON.stringify({ layer: 'owned', items: [bad] }));
  assert.throws(() => mergeDir(dir), /./, 'a bad item url fails at merge time');
  assert.throws(() => readFileSync(join(dir, 'evidence.json')), /ENOENT/, 'and nothing is written');
  writeFileSync(join(dir, 'fragments', 'owned.json'), JSON.stringify({ layer: 'owned', items: [mitem('a')] }));
  assert.deepEqual(mergeDir(dir), { items: 1, fragments: 1 });
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'evidence-ids.json'), 'utf8')), { a: 'E001' });
  // Re-merging with another item first keeps the earlier id.
  writeFileSync(join(dir, 'fragments', 'paid.json'), JSON.stringify({ layer: 'paid', items: [mitem('z', 'google_ads')] }));
  mergeDir(dir);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'evidence-ids.json'), 'utf8')), { z: 'E002', a: 'E001' });
});

// ---------- plays and uncovered ----------

const PS = (o) => ({ activities: Object.fromEntries(Object.entries(o).map(([id, v]) => [id, sc(v)])) });
test('pickPlays: the analyst\'s plays are not padded to fill the hero', () => {
  const picked = pickPlays(PS({ google_ads: 95, organic_social: 90, comparison: 85 }), { plays: [{ activity: 'comparison' }] });
  assert.deepEqual(picked.map((r) => r.id), ['comparison']);
});
test('pickPlays: without plays or takeaways, only scores of 40 or more are plays', () => {
  const picked = pickPlays(PS({ pricing: 39, aeo: 30, seo_content: 40 }), {});
  assert.deepEqual(picked.map((r) => r.id), ['seo_content']);
  assert.deepEqual(pickPlays(PS({ pricing: 39 }), {}), []);
});
test('scoreRows: a score of 0 without a checked absence or evidence is uncovered; with either it is not', () => {
  const rows = (s) => Object.fromEntries(scoreRows({ activities: s }).map((r) => [r.id, r.state]));
  const r = rows({
    google_ads: { score: 0, confidence: 0.9, basis: 'jev', evidence_ids: [] },
    pricing: { score: 0, confidence: 0.9, basis: 'jev', evidence_ids: ['E001'] },
    aeo: { score: 0, confidence: 0.9, basis: 'checked_absence', evidence_ids: [] },
    video: { score: 0, confidence: null, basis: 'analyst', evidence_ids: [] },
  });
  assert.equal(r.google_ads, 'uncovered');
  assert.equal(r.video, 'uncovered');
  assert.equal(r.pricing, 'scored');
  assert.equal(r.aeo, 'absent');
});

// ---------- takeaways ----------

const take = (o = {}) => ({ activity: 'google_ads', move: 'Test more angles on the ads that already run.', observed: 'Many ads run for months.', evidence_ids: ['E001'], ...o });

test('render: a takeaway on an activity scored 0 or not covered is dropped with a warning', () => {
  const { evidence, analysis } = load();
  const scores = allScores(evidence, { video: null });
  scores.activities.pricing = sc(0, 0.9, 'jev', ['E001']);
  scores.activities.events = sc(0, 0.9, 'jev', []);
  analysis.takeaways = [take({ activity: 'video' }), take({ activity: 'pricing' }), take({ activity: 'events' }), take()];
  const { html, warnings } = render(evidence, analysis, scores);
  for (const a of ['video', 'pricing', 'events']) assert.ok(warnings.some((w) => w.includes(`takeaways: dropped "${a}"`)), `${a}: ${warnings.join(' | ')}`);
  const links = [...sectionOf(html, 'take').matchAll(/href="#(a-\w+)">See details/g)].map((m) => m[1]);
  assert.deepEqual(links, ['a-google_ads']);
});
test('render: a takeaway whose move copies a plays.md Move sentence warns', () => {
  const { evidence, analysis } = load();
  const copied = 'Post one useful thing a week in the style your buyers already read, and reuse the best into a thread or short video.';
  analysis.takeaways = [take({ activity: 'organic_social', move: copied })];
  const r = render(evidence, analysis);
  assert.ok(r.warnings.some((w) => /copies references\/plays\.md word for word/.test(w)), r.warnings.join(' | '));
  analysis.takeaways = [take({ activity: 'organic_social', move: 'Post weekly about how your customers use the API.' })];
  assert.ok(!render(evidence, analysis).warnings.some((w) => /plays\.md/.test(w)));
});
test('render: couldnt_see lines carry a Source link', () => {
  const { evidence, analysis } = load();
  analysis.couldnt_see = [{ text: 'We could not see their email program.', evidence_ids: [evidence.items[0].id] }];
  const { html } = render(evidence, analysis);
  const li = html.split('We could not see their email program.')[1].split('</li>')[0];
  assert.match(li, /Source/);
  assert.match(li, /href="https?:\/\//);
});
test('each scored block says how many findings are behind its score', () => {
  const { evidence, analysis } = load();
  const scores = allScores(evidence);
  scores.activities.google_ads.evidence_ids = ['E001'];
  scores.activities.pricing.evidence_ids = ['E001', 'E002', 'E003'];
  const { html } = render(evidence, analysis, scores);
  assert.match(paneOf(html, 'google_ads'), /<p class="asub">1 finding behind this score<\/p>/);
  assert.match(paneOf(html, 'pricing'), /<p class="asub">3 findings behind this score<\/p>/);
});

// ---------- traffic floor ----------

test('traffic under 1,000 visits a month shows a sentence, not a chart', () => {
  const { evidence, analysis } = load();
  evidence.traffic = { evidence_id: evidence.items[0].id, label: 'Monthly visits', source: 'Similarweb', source_url: 'https://www.similarweb.com/website/x/', points: [{ month: '2026-05', value: 120 }, { month: '2026-06', value: 900 }] };
  const t = sectionOf(render(evidence, analysis).html, 'traffic');
  assert.match(t, /Too little traffic to show a trend/);
  assert.match(t, /at most 900/);
  assert.ok(!/<svg|<circle/.test(t));
  assert.match(t, /href="https:\/\/www\.similarweb\.com\/website\/x\/"/, 'the safe source_url is used');
  evidence.traffic.source_url = 'javascript:alert(1)';
  const bad = sectionOf(render(evidence, analysis).html, 'traffic');
  assert.ok(!/javascript:/.test(bad), 'an unsafe source_url is never linked');
  evidence.traffic.points[1].value = 1000;
  assert.match(sectionOf(render(evidence, analysis).html, 'traffic'), /<svg/, '1,000 draws the chart');
});

// ---------- own vs other ads ----------

test('google ads: ads run by other advertisers are named as such and never drawn in the strip', () => {
  const { evidence, analysis } = load();
  const mk = (id, own, days) => ({ id, platform: 'google', format: 'text', days_shown: days, first_shown: '2026-06-01', image_url: `https://tpc.googlesyndication.com/${id}`, width: 300, url: `https://adstransparency.google.com/advertiser/A/creative/${id}`, ...(own === undefined ? {} : { own }) });
  evidence.ads = [mk('AD1', true, 50), mk('AD2', undefined, 40), mk('AD3', false, 900), mk('AD4', false, 800)];
  const pane = paneOf(render(evidence, analysis).html, 'google_ads');
  assert.match(pane, /We collected 4, of which 2 were run by other advertisers pointing at the site and 2 by the company/);
  const items = stripItems(stripOf(pane));
  assert.equal(items.length, 2);
  assert.ok(!stripOf(pane).includes('AD3') && !stripOf(pane).includes('/AD4'), 'the others are not shown');
  assert.ok(!/ads run by other/.test(paneOf(render({ ...evidence, ads: [mk('AD1', true, 5)] }, analysis).html, 'google_ads')));
});

// ---------- replies hidden, YouTube subscribers ----------

test('posts marked reply: true never appear in strips', () => {
  const { evidence, analysis } = load();
  const xs = evidence.posts.filter((p) => p.platform === 'x' && p.owner === 'company');
  const top = [...xs].sort((a, b) => (b.metrics.likes ?? 0) - (a.metrics.likes ?? 0))[0];
  const before = paneOf(render(evidence, analysis).html, 'organic_social');
  assert.ok(before.includes(top.id) || before.includes(top.url), 'the best post is shown normally');
  top.reply = true;
  const after = paneOf(render(evidence, analysis).html, 'organic_social');
  assert.ok(!after.includes(top.url), 'the reply is hidden');
});
test('a YouTube channel card says subscribers, other platforms say followers', () => {
  const { evidence, analysis } = load();
  evidence.accounts.push({ platform: 'youtube', handle: '@exa', url: 'https://www.youtube.com/@exa', owner: 'company', followers: 54321, evidence_id: evidence.items[0].id });
  const html = render(evidence, analysis).html;
  assert.match(html, /<b>54k<\/b> subscribers/);
  assert.match(html, /<\/b> followers/);
  assert.ok(!/<b>54k<\/b> followers/.test(html));
});
