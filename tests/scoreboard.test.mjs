import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderReport } from '../scripts/render.mjs';
import { ACTIVITIES } from '../scripts/activities.mjs';
import { coverage } from '../scripts/coverage.mjs';
import { SECTIONS, activityRows } from '../scripts/scoreboard.mjs';
import { dropActivities, paneOf, sectionOf, ACT_RE } from './helpers.mjs';

const FIXES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const EXA = join(FIXES, 'exa.ai');
const NOTION = join(FIXES, 'notion.com');
const load = (dir) => ({
  evidence: JSON.parse(readFileSync(join(dir, 'evidence.json'), 'utf8')),
  analysis: JSON.parse(readFileSync(join(dir, 'analysis.json'), 'utf8')),
});
const run = (dir, mutate = () => {}) => {
  const { evidence, analysis } = load(dir);
  const ev = mutate(evidence, analysis) ?? evidence;
  return renderReport(ev, analysis, { baseDir: dir });
};
const seen = (evidence) => Object.entries(coverage(evidence).activities).filter(([, v]) => v.state === 'seen').map(([id]) => id);

// The state line of one activity block, as the words shown.
// The state pill of an activity block: Seen shows none; the others say so.
const state = (html, id) => paneOf(html, id).match(/<span class="state[^"]*">([^<]+)<\/span>/)?.[1] ?? 'Seen';

// ---------- coverage ----------

test('coverage: seen when there are facts, absent only with a recorded check, otherwise uncovered; never a number', () => {
  const { evidence } = load(EXA);
  const cov = coverage(evidence);
  assert.equal(Object.keys(cov.activities).length, ACTIVITIES.length, 'every activity has an entry');
  for (const v of Object.values(cov.activities)) {
    assert.ok(['seen', 'absent', 'uncovered'].includes(v.state));
    assert.ok(!('score' in v) && !('confidence' in v), 'nothing is scored');
  }
  // Only items with absent:true and a probe make "absent".
  const bare = { domain: 'x.test', captured_at: '2026-10-20T00:00:00Z', items: [
    { id: 'E001', channel: 'comparison', status: 'observed', absent: true, probe: 'Read the sitemap', finding: 'None.', url: 'https://x.test/' },
    { id: 'E002', channel: 'events', status: 'couldnt_check', finding: 'Blocked.', url: 'https://x.test/' },
  ] };
  const c = coverage(bare).activities;
  assert.equal(c.comparison.state, 'absent');
  assert.equal(c.comparison.probe, 'Read the sitemap');
  assert.equal(c.events.state, 'uncovered', 'a failed check is not an absence');
  assert.equal(c.video.state, 'uncovered', 'nothing recorded is not an absence either');
});

test('coverage: a structured block counts as seen only through a real evidence item', () => {
  const ev = { domain: 'x.test', captured_at: '2026-10-20T00:00:00Z', items: [], site: { evidence_id: null, total_urls: 0 }, ads: [] };
  assert.equal(coverage(ev).activities.seo_content.state, 'uncovered', 'zero pages is not evidence');
  assert.equal(coverage(ev).activities.google_ads.state, 'uncovered');
});

test('meta ads from the library make Paid social seen', () => {
  const ev = { domain: 'x.test', captured_at: '2026-10-20T00:00:00Z',
    items: [{ id: 'E001', channel: 'meta_ads', status: 'observed', finding: 'Meta Ad Library lists 3 ads from X.', url: 'https://www.facebook.com/ads/library/?q=x' }],
    meta_ads: { source: 'Meta Ad Library', advertiser: { id: 'x', name: 'X' }, ads: [], evidence_id: 'E001' } };
  assert.equal(coverage(ev).activities.paid_social.state, 'seen');
});

// ---------- plays ----------

// ---------- blocks ----------

test('blocks: seen ones say Seen with a finding count; unseen ones say Not covered and carry no strip or number', () => {
  const { evidence } = load(EXA);
  const saw = seen(evidence);
  const { html } = run(EXA);
  for (const a of ACTIVITIES) {
    const block = paneOf(html, a.id);
    if (saw.includes(a.id)) {
      assert.equal(state(html, a.id), 'Seen', a.id);
      assert.ok(!/findings?<|class="asub"/.test(block), 'no finding counts');
    } else {
      assert.equal(state(html, a.id), 'Not covered', a.id);
      assert.ok(!/Checked, none found/.test(block), 'not covered is not absent');
      assert.match(block, /We could not look at this in this run\./);
      assert.ok(!/\d/.test(block.replace(/<h3>[^<]*<\/h3>/, '').replace(/id="[^"]*"/g, '')), `${a.id}: no number in an uncovered block`);
    }
  }
  assert.ok(!/<small>\/100<\/small>|class="ascore|class="abar|class="pscore/.test(html.split('<main')[1]), 'no score, bar or number chip anywhere');
});

test('a checked absence is the only way to say "Checked, none found"', () => {
  const { evidence, analysis } = load(EXA);
  const ev = dropActivities(evidence, ['aeo']);
  ev.items.push({ id: 'E100', collector: 'owned', channel: 'ai_search', status: 'observed', absent: true, probe: 'Fetched /robots.txt and /llms.txt', finding: 'No llms.txt.', url: 'https://exa.ai/llms.txt', captured_at: '2026-10-20T03:00:00Z' });
  const r = renderReport(ev, analysis, { baseDir: EXA });
  assert.equal(state(r.html, 'aeo'), 'Checked, none found');
});

// ---------- reads ----------

test('reads for an unknown activity (including the retired sales_motion) are dropped with a warning', () => {
  const r = run(EXA, (ev, an) => {
    an.reads = [{ activity: 'sales_motion', read: 'Phantom read text.', evidence_ids: ['E001'] }, { activity: 'google_ads', read: 'Real read text.', evidence_ids: ['E001'] }];
  });
  assert.ok(r.warnings.some((w) => /reads: dropped an entry for unknown activity "sales_motion"/.test(w)));
  assert.ok(!r.html.includes('Phantom read text.') && !r.html.includes('sales_motion'));
  assert.match(r.html, /Real read text\./);
});

test('reads citing an unknown evidence id make renderReport throw (the data is broken)', () => {
  assert.throws(() => run(EXA, (ev, an) => { an.reads = [{ activity: 'google_ads', read: 'x', evidence_ids: ['E999'] }]; }), /unknown evidence id E999/);
});

test('an analysis that still carries activity_levels or a scores.json is ignored: nothing is scored', () => {
  const r = run(EXA, (ev, an) => { an.activity_levels = [{ activity: 'google_ads', level: 3, evidence_ids: ['E001'] }]; });
  assert.ok(!/<small>\/100<\/small>|Scores by|activity_levels|class="ascore/.test(r.html.replace(/data:[^"')]+/g, '')));
  assert.deepEqual(r.warnings, []);
});

// ---------- anchors ----------

test('every activity has one article#a-<id>, inside its section; every in-page activity link lands on one', () => {
  const { html } = run(EXA);
  for (const a of ACTIVITIES) {
    assert.equal((html.match(new RegExp(ACT_RE(a.id).source, 'g')) ?? []).length, 1, `block for ${a.id}`);
    const sec = SECTIONS.find((x) => x.activities.includes(a.id));
    assert.ok(sectionOf(html, `s-${sec.id}`).includes(`id="a-${a.id}"`), `${a.id} sits in section ${sec.id}`);
  }
  for (const m of html.matchAll(/href="#(a-[\w]+)"/g)) assert.ok(html.includes(`id="${m[1]}"`), `${m[1]} has no block`);
});

// ---------- folds, source line ----------

test('no activity block has a fold, a by-date list, charts, tables or open roles', () => {
  for (const dir of [EXA, NOTION]) {
    const { html } = run(dir, (ev) => { ev.roles = { evidence_id: ev.items[0].id, items: [{ title: 'Zebra Wrangler', function: 'Sales' }] }; });
    const body = html.split('<main')[1];
    assert.ok(!/fold2|Findings and sources|What they did, by date|How their accounts perform|What they publish/.test(body), dir);
    for (const a of ACTIVITIES) {
      const block = paneOf(html, a.id);
      assert.ok(!block.includes('<details') && !block.includes('<summary'), `${a.id}: no fold`);
      assert.ok(!/<table|<svg class="tchart"|class="tl |class="bars|class="plans|class="pair"|class="dp-row"|class="sb-row"/.test(block), `${a.id}: no chart or table`);
      assert.match(block, /^\s*(?:<header class="ahead">|<p class="aread)/);
      assert.equal((block.match(/<p class="aread/g) ?? []).length, 1, `${a.id}: exactly one read`);
    }
    assert.ok(!/Zebra/.test(html));
  }
});

test('source line: up to four external links labelled by host and path, de-duplicated by url, the read\'s own evidence first', () => {
  // The AI-search block has no linked examples, so it keeps a source line. Give it several evidence items.
  const r = run(EXA, (ev, an) => {
    ev.items.slice(0, 7).forEach((it, i) => { it.url = `https://src${i}.example/p/${i}`; it.channel = 'ai_search'; });
    ev.items[1].url = ev.items[0].url;
    an.reads = [{ activity: 'aeo', read: 'Read.', evidence_ids: ['E007'] }];
  });
  const block = paneOf(r.html, 'aeo');
  const line = block.match(/<p class="srcline"><span class="slab">Sources<\/span>([\s\S]*?)<\/p>/)[1];
  const links = [...line.matchAll(/<a class="schip" href="([^"]+)" target="_blank" rel="noopener noreferrer" aria-label="Source for: [^"]+">([^<]+)<span aria-hidden="true"> ↗<\/span><\/a>/g)];
  assert.ok(links.length >= 1 && links.length <= 4);
  const hrefs = links.map((m) => m[1]);
  assert.equal(new Set(hrefs).size, hrefs.length, 'de-duplicated by url');
  assert.equal(hrefs[0], 'https://src6.example/p/6');
  assert.equal(links[0][2], 'src6.example/p/6');
  assert.ok(!/E00\d/.test(line), 'no visible evidence ids');
  const bad = run(EXA, (ev) => { ev.items[0].finding = '<img src=x onerror=alert(1)>'; ev.items[0].channel = 'ai_search'; ev.items[0].url = 'https://x.example/a?b=1&c=2'; });
  const l2 = paneOf(bad.html, 'aeo').match(/<p class="srcline">[\s\S]*?<\/p>/)?.[0] ?? '';
  assert.ok(!l2.includes('<img'));
  if (l2.includes('x.example')) assert.ok(l2.includes('?b=1&amp;c=2'));
});

test('source line: a checked absence shows the probe that was run, escaped', () => {
  const { evidence, analysis } = load(NOTION);
  const ev = dropActivities(evidence, ['comparison']);
  ev.items.push({ id: 'E100', collector: 'owned', channel: 'comparison', status: 'observed', absent: true, probe: 'Searched sitemap for <b>/vs/</b> & /compare/', finding: 'No comparison pages.', url: 'https://www.notion.com/sitemap.xml', captured_at: '2026-10-20T03:00:00Z' });
  const r = renderReport(ev, analysis, { baseDir: NOTION });
  const c = paneOf(r.html, 'comparison');
  assert.match(c, /<p class="facts muted">Checked: Searched sitemap for &lt;b&gt;\/vs\/&lt;\/b&gt; &amp; \/compare\/<\/p>/);
  assert.match(c, /<span class="state state-absent">Checked, none found<\/span>/);
  assert.match(c, /<p class="aread">We checked and found nothing\.<\/p>/);
  assert.ok(!/Checked: /.test(paneOf(r.html, 'pricing')));
});

// ---------- sections ----------

test('every activity appears in exactly one SECTIONS entry, and every SECTIONS entry names a known activity', () => {
  const known = ACTIVITIES.map((a) => a.id);
  const listed = SECTIONS.flatMap((x) => x.activities);
  for (const id of known) assert.equal(SECTIONS.filter((x) => x.activities.includes(id)).length, 1, id);
  for (const id of listed) assert.ok(known.includes(id), id);
  assert.equal(listed.length, known.length);
  assert.equal(new Set(SECTIONS.map((x) => x.id)).size, SECTIONS.length);
  assert.equal(ACTIVITIES.length, 18);
  assert.equal(activityRows(coverage({ items: [] })).length, 18);
});

test('the report has no headline, play cards, takeaways or footer: the page is the company, then the evidence', () => {
  const r = run(EXA, (ev, an) => { an.headline = { text: 'Grows through ads.', evidence_ids: ['E001'] }; an.plays = [{ activity: 'google_ads' }]; an.takeaways = [{ activity: 'google_ads', move: 'Do it.', observed: 'x', evidence_ids: ['E001'] }]; });
  const body = r.html.split('<main')[1];
  assert.ok(!/class="lede"|class="plays"|class="gplay"|id="take"|What you can take|Their main growth plays|<footer class="about|Public data only|Made with Growth Sneak/.test(body));
  assert.ok(!r.html.includes('Grows through ads.') && !r.html.includes('Do it.'));
  assert.deepEqual(r.warnings, [], 'old fields in analysis.json are ignored without a warning');
  assert.match(body, /<header id="summary" class="hero"[^>]*>\s*<div class="brand">[\s\S]*?<\/header>/);
  assert.match(body, /Collected \d+ \w+ \d{4}<\/p>/);
});
