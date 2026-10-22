import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderReport } from '../scripts/render.mjs';
import { CHANNEL_BY_ID } from '../scripts/channels.mjs';
import { merge } from '../scripts/merge.mjs';
import { paneOf, sectionOf } from './helpers.mjs';

// The new sections: site traffic, tech stack and the inline AEO checklist.
const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'exa.ai');
const load = () => ({
  evidence: JSON.parse(readFileSync(join(FIX, 'evidence.json'), 'utf8')),
  analysis: JSON.parse(readFileSync(join(FIX, 'analysis.json'), 'utf8')),
});
const render = (ev, an) => renderReport(ev, an, { baseDir: FIX });
const traffic = (ev, points, extra = {}) => ({ evidence_id: ev.items[0].id, label: 'Monthly visits', source: 'Similarweb', points, ...extra });
const pts = (...vals) => vals.map((value, i) => ({ month: `2026-${String(i + 5).padStart(2, '0')}`, value }));

// ---------- site traffic ----------

test('traffic: a line chart with an sr-only data table, a cited source link and a summary that says up by the right percent', () => {
  const { evidence, analysis } = load();
  evidence.traffic = traffic(evidence, pts(100000, 120000, 150000));
  const { html, warnings } = render(evidence, analysis);
  assert.deepEqual(warnings, []);
  const t = sectionOf(html, 'traffic');
  assert.match(t, /<h2 id="traffic-h">Site traffic<\/h2>/);
  assert.match(t, /<svg class="tchart"[^>]*role="img" aria-label="Monthly visits: 150k visits in Jul, up 50% since May"/);
  assert.match(t, /<path d="M[^"]+" class="tline"\/>/, 'a line');
  assert.equal((t.match(/<circle /g) ?? []).length, 3, 'one dot per month');
  assert.match(t, /<p class="tsum"><b>150k visits in Jul, up 50% since May\.<\/b>/);
  const table = t.match(/<table class="sr-only">[\s\S]*?<\/table>/)[0];
  assert.match(table, /<caption>Monthly visits<\/caption>/);
  assert.deepEqual([...table.matchAll(/<tr><th>([^<]+)<\/th><td>([^<]+)<\/td><\/tr>/g)].map((m) => [m[1], m[2]]), [['2026-05', '100,000'], ['2026-06', '120,000'], ['2026-07', '150,000']]);
  assert.match(t, /<a class="ext" href="https?:\/\/[^"]+" [^>]*aria-label="Source: Similarweb traffic estimates">Source/);
  assert.ok(!/NaN|undefined|Infinity/.test(t));
});

test('traffic: down, flat and from-zero are worded correctly, points are sorted by month, and the chart is in the rail', () => {
  const { evidence, analysis } = load();
  evidence.traffic = traffic(evidence, pts(200000, 180000, 150000));
  assert.match(sectionOf(render(evidence, analysis).html, 'traffic'), /150k visits in Jul, down 25% since May/);
  evidence.traffic = traffic(evidence, pts(100000, 90000, 100000));
  assert.match(sectionOf(render(evidence, analysis).html, 'traffic'), /, flat since May/);
  // Out-of-order input is sorted, so "since" names the earliest month.
  evidence.traffic = traffic(evidence, [{ month: '2026-07', value: 150000 }, { month: '2026-05', value: 100000 }]);
  const h = render(evidence, analysis).html;
  assert.match(sectionOf(h, 'traffic'), /Jul, up 50% since May/);
  assert.match(h, /<li><a href="#traffic"><span>Site traffic<\/span><\/a><\/li>/);
  // A start of zero never prints Infinity or NaN; all zeros draw no chart.
  evidence.traffic = traffic(evidence, pts(0, 5000));
  const z = sectionOf(render(evidence, analysis).html, 'traffic');
  assert.ok(!/NaN|Infinity/.test(z));
  assert.match(z, /up from none since May/);
  evidence.traffic = traffic(evidence, pts(0, 0));
  assert.equal(sectionOf(render(evidence, analysis).html, 'traffic'), '');
});

test('traffic: absent without data, and with fewer than two points', () => {
  const { evidence, analysis } = load();
  assert.ok(!evidence.traffic);
  const none = render(evidence, analysis).html;
  assert.ok(!none.includes('id="traffic"') && !none.includes('Site traffic</a>'), 'no section and no rail entry');
  assert.ok(!none.includes('class="tchart"'));
  evidence.traffic = traffic(evidence, pts(100000));
  const one = render(evidence, analysis).html;
  assert.ok(!one.includes('id="traffic"') && !one.includes('class="tchart"'), 'one point is not a trend');
  evidence.traffic = traffic(evidence, []);
  assert.ok(!render(evidence, analysis).html.includes('id="traffic"'));
});

test('traffic: bad data is a build error (bad month, non-number, negative, missing or unknown evidence id, points not a list)', () => {
  const { evidence, analysis } = load();
  const bad = (t, re) => { evidence.traffic = t; assert.throws(() => render(evidence, analysis), re); };
  bad(traffic(evidence, [{ month: 'May 2026', value: 1 }, { month: '2026-06', value: 2 }]), /traffic: "points" must be a list/);
  bad(traffic(evidence, [{ month: '2026-5', value: 1 }, { month: '2026-06', value: 2 }]), /traffic: "points" must be a list/);
  bad(traffic(evidence, [{ month: '2026-05', value: '100' }, { month: '2026-06', value: 2 }]), /traffic: "points" must be a list/);
  bad(traffic(evidence, [{ month: '2026-05', value: null }, { month: '2026-06', value: 2 }]), /traffic: "points" must be a list/);
  bad(traffic(evidence, [{ month: '2026-05', value: -4 }, { month: '2026-06', value: 2 }]), /traffic: "points" must be a list/);
  bad(traffic(evidence, 'lots'), /traffic: "points" must be a list/);
  bad({ ...traffic(evidence, pts(1, 2)), evidence_id: undefined }, /traffic: "evidence_id" must name an existing evidence item/);
  bad(traffic(evidence, pts(1, 2), { evidence_id: 'E999' }), /traffic: "evidence_id" must name an existing evidence item/);
});

test('traffic is a channel, and merge keeps it as one block with its evidence ref resolved', () => {
  assert.ok(CHANNEL_BY_ID.traffic);
  const run = { domain: 'x.test', captured_at: '2026-10-20T00:00:00Z' };
  const item = { ref: 't1', channel: 'traffic', status: 'observed', finding: 'About 100k visits a month (Similarweb estimate).', url: 'https://www.similarweb.com/website/x.test/' };
  const { evidence } = merge(run, [{ layer: 'company', items: [item], traffic: { metric: 'visits', label: 'Monthly visits', points: pts(1, 2), source: 'Similarweb', evidence_ref: 't1' } }]);
  assert.equal(evidence.traffic.evidence_id, 'E001');
  assert.ok(!('evidence_ref' in evidence.traffic));
  assert.throws(() => merge(run, [{ layer: 'company', items: [item], traffic: { points: pts(1, 2), evidence_ref: 'nope' } }]), /does not match any item ref/);
  // And a full pipeline run renders it.
  const full = { ...load().evidence, traffic: { ...evidence.traffic, evidence_id: load().evidence.items[0].id } };
  assert.ok(render(full, load().analysis).html.includes('id="traffic"'));
});

// ---------- tech stack ----------

test('tech stack: only tool names, as chips, de-duplicated, with a source link and a rail entry; no category text and no notes', () => {
  const { evidence, analysis } = load();
  evidence.tech.tools.push({ tool: evidence.tech.tools[0].tool, category: 'Duplicate category' });
  const html = render(evidence, analysis).html;
  const tech = sectionOf(html, 'tech');
  assert.match(tech, /<h2 id="tech-h">Tech stack<\/h2>/);
  const chips = [...tech.matchAll(/<li>([^<]*)<\/li>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
  const names = [...new Set(evidence.tech.tools.map((t) => t.tool))];
  assert.ok(new Set(evidence.tech.tools.map((t) => t.category)).size >= 3);
  assert.deepEqual(chips, names, 'one chip per distinct tool, in order, nothing else');
  assert.equal((tech.match(/<ul class="chips">/g) ?? []).length, 1);
  for (const cat of new Set(evidence.tech.tools.map((t) => t.category))) assert.ok(!tech.includes(cat.replace(/&/g, '&amp;')), `category "${cat}" is not shown`);
  for (const note of evidence.tech.notes ?? []) assert.ok(!tech.includes(note.slice(0, 30)), 'notes are not shown');
  assert.ok(!/<table|<th |<dl/.test(tech));
  assert.match(tech, /<a class="ext"[^>]*aria-label="Source: tech stack visit"/);
  assert.match(html, /<li><a href="#tech"><span>Tech stack<\/span><\/a><\/li>/, 'no number on the tech rail entry');
});

test('tech stack: absent with no tech data; an empty tool list says nothing loaded instead of inventing rows; hostile names are escaped', () => {
  const { evidence, analysis } = load();
  const t = evidence.tech;
  delete evidence.tech;
  const none = render(evidence, analysis).html;
  assert.ok(!none.includes('id="tech"') && !none.includes('Tech stack'));
  evidence.tech = { ...t, tools: [], notes: [] };
  const empty = sectionOf(render(evidence, analysis).html, 'tech');
  assert.match(empty, /No third-party tools loaded during the visit\./);
  assert.ok(!empty.includes('<table'));
  evidence.tech = { ...t, tools: [{ tool: '<script>alert(1)</script>', category: 'A&B' }] };
  const bad = render(evidence, analysis).html;
  assert.ok(!bad.includes('<script>alert(1)'));
  assert.equal((bad.match(/<script/g) ?? []).length, 1);
  assert.ok(bad.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  evidence.tech = { tools: 'none', evidence_id: evidence.items[0].id };
  assert.throws(() => render(evidence, analysis), /tech: "tools" must be an array/);
});

// ---------- AEO checklist ----------

test('the AEO checklist is an inline ul.ck in a .inl block, with ticks, crosses and words, and no folds', () => {
  const { evidence, analysis } = load();
  evidence.site_checks.checks.push({ check: 'Sitemap reachable', result: 'unknown', detail: 'Timed out' });
  const block = paneOf(render(evidence, analysis).html, 'aeo');
  assert.match(block, /<div class="inl"><ul class="ck">/);
  assert.ok(!block.includes('<details'), 'the checklist is visible without opening anything');
  assert.ok(!block.includes('<h4>'), 'no sub-heading: the block is only the checklist');
  const items = [...block.matchAll(/<li><span class="gl gl-(yes|no|unknown)" aria-hidden="true">(.)<\/span><span class="ckt"><b>([^<]+)<\/b><span class="sr-only">: ([^<]+)<\/span>/g)];
  assert.equal(items.length, evidence.site_checks.checks.length, 'one tile per check');
  const glyph = { yes: '✓', no: '✕', unknown: '?' };
  const word = { yes: /^Yes$/, no: /^No$/, unknown: /^Couldn't check$/ };
  for (const [, result, g, , text] of items) {
    assert.equal(g, glyph[result]);
    assert.match(text, word[result], 'the answer is written for screen readers, never colour or a glyph alone');
  }
  assert.ok(items.some((m) => m[1] === 'yes') && items.some((m) => m[1] === 'no') && items.some((m) => m[1] === 'unknown'));
  assert.match(block, /<p class="srcline"><span class="slab">Sources<\/span>/, 'the evidence behind it is linked below');
});

test('without site checks there is no checklist block, and an invalid result is a build error', () => {
  const { evidence, analysis } = load();
  evidence.site_checks.checks = [];
  assert.ok(!paneOf(render(evidence, analysis).html, 'aeo').includes('class="ck"'));
  delete evidence.site_checks;
  assert.ok(!paneOf(render(evidence, analysis).html, 'aeo').includes('class="ck"'));
  const again = load();
  again.evidence.site_checks.checks[0].result = 'maybe';
  assert.throws(() => render(again.evidence, again.analysis), /result must be yes, no or unknown/);
});
