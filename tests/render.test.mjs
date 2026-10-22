import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderReport, hasPreview } from '../scripts/render.mjs';
import { dropActivities, paneOf, stripOf, stripItems, sectionOf, kfRows } from './helpers.mjs';
import { SECTIONS } from '../scripts/scoreboard.mjs';
import { STRIP_MAX } from '../scripts/proof.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'notion.com');
const load = () => ({
  evidence: JSON.parse(readFileSync(join(FIX, 'evidence.json'), 'utf8')),
  analysis: JSON.parse(readFileSync(join(FIX, 'analysis.json'), 'utf8')),
});
const render = (ev, an) => renderReport(ev, an, { baseDir: FIX });
const adCards = (html) => html.split('<figure class="xad"').slice(1).map((s) => s.split('</figure>')[0]);

// ---------- structure ----------

test('renders the shell: rail, hero, activity sections, tech stack and gaps, with no footer; the old furniture is gone', () => {
  const { evidence, analysis } = load();
  const { html, warnings } = render(evidence, analysis);
  assert.match(html, /<div class="shell">\s*<nav class="rail" aria-label="Sections">/);
  assert.match(html, /<main id="report">/);
  assert.match(html, /<header id="summary" class="hero"/);
  for (const id of ['tech', 'gaps']) assert.match(html, new RegExp(`<section id="${id}"`), `missing section ${id}`);
  for (const sec of SECTIONS) assert.match(html, new RegExp(`<section id="s-${sec.id}" class="block"`), `missing section s-${sec.id}`);
  // Removed features must not come back: ribbon, hero card, strongest-signals card, tabbed panes, messaging, sources appendix.
  for (const gone of ['activities', 'scores', 'messaging', 'sources', 'srcSearch', 'map', 'glance', 'working', 'funnel']) assert.ok(!html.includes(`id="${gone}"`), `the ${gone} section is gone`);
  assert.ok(!/class="ribbon|class="hb-row|class="stagecard|class="srow|class="sc-detail|class="gcard|class="bcard|Strongest signals|How they say it|data-hay|<details class="sources"/.test(html.split('<main')[1].split('</main>')[0]), 'removed furniture is gone');
  assert.ok(!html.includes('"#E0'), 'no numeric jump links to evidence anchors');
  assert.ok(!html.includes('<footer class="about'), 'no footer');
  assert.match(html, /<a class="skip" href="#report">/);
  assert.deepEqual(warnings, [], 'the fixture should render without adjustments');
  assert.match(html, /<title>How Notion grows · Growth Sneak<\/title>/);
});

test('output is deterministic', () => {
  const { evidence, analysis } = load();
  assert.equal(render(evidence, analysis).html, render(evidence, analysis).html);
});

test('reading flow has no dashboard furniture: no stat tiles, chips, highlighter marks or visible evidence ids', () => {
  const { evidence, analysis } = load();
  const { html } = render(evidence, analysis);
  const main = html.split('<main')[1];
  for (const cls of ['stat', 'tile', 'chip', 'cite', 'mark']) {
    assert.ok(!new RegExp(`class="[^"]*\\b${cls}\\b`).test(main), `found class "${cls}" in the reading flow`);
  }
  assert.ok(!/>E\d{3}</.test(main), 'evidence ids must not be shown as visible text in the reading flow');
});

test('the hero is the brand only: name, domain and capture date, with no lede, cards or "Public data only"', () => {
  const { evidence, analysis } = load();
  const { html } = render(evidence, analysis);
  const hero = html.split('<header id="summary"')[1].split('</header>')[0];
  assert.match(hero, /<h1>Notion<\/h1>/);
  assert.ok(!/class="lede"|Public data only|class="plays"/.test(hero));
  assert.match(hero, /Collected \d+ \w+ \d{4}<\/p>/);
  assert.equal(html.split('<h1').length - 1, 1, 'one h1');
  assert.ok(html.indexOf('<h1') < html.indexOf('<h2'), 'no section heading before the brand');
  const visible = html.split('<main')[1];
  assert.ok((visible.match(/600–700|600-700/g) ?? []).length <= 3, 'the ad total should be visible at most three times');
});

// ---------- citations ----------

test('citations: nothing shows evidence ids or numeric jump links; the only inline source links are real external links', () => {
  const { evidence, analysis } = load();
  const { html } = render(evidence, analysis);
  assert.ok(!/class="fnlink"|class="fn"|class="srcs"|aria-controls="fp/.test(html), 'the footnote machinery is gone');
  assert.ok(!/id="E\d+"/.test(html), 'there are no evidence anchors to jump to');
  const main = html.split('<main')[1];
  assert.ok(!/>E\d{3}</.test(main), 'evidence ids are never visible text');
  for (const m of main.matchAll(/<a class="ext" href="([^"]+)"/g)) assert.match(m[1], /^https?:\/\//);
});

test('source links have descriptive accessible names: block source lines and the traffic/tech Source links', () => {
  const { evidence, analysis } = load();
  const { html } = render(evidence, analysis);
  const lines = [...html.matchAll(/<p class="srcline">([\s\S]*?)<\/p>/g)].map((m) => m[1]);
  assert.ok(lines.length >= 1, 'blocks whose examples do not link to the originals end with a source line');
  for (const l of lines) {
    assert.match(l, /^<span class="slab">Sources<\/span>/, 'the line is labelled Sources');
    const links = [...l.matchAll(/<a class="schip"[^>]*>/g)].map((m) => m[0]);
    assert.ok(links.length >= 1 && links.length <= 4);
    for (const a of links) {
      assert.match(a, /aria-label="Source for: [^"]+"/);
      assert.match(a, /href="https?:\/\/[^"]+" target="_blank" rel="noopener noreferrer"/, 'external');
    }
  }
  const plain = [...html.matchAll(/<a class="ext"[^>]*>Source</g)].map((m) => m[0]);
  assert.ok(plain.length >= 1);
  for (const l of plain) assert.match(l, /aria-label="Source(?: for)?: [^"]+"/);
});

// ---------- channels ----------

const GAP_RE = /<p class="gapline"><b>Not covered:<\/b> ([^<]+)\./;
const gapOf = (html) => (html.match(GAP_RE)?.[1] ?? '').replace(/&amp;/g, '&');
// A tiny evidence file: one item per [channel, status, extra] row.
const tiny = (rows, extra = {}) => ({
  domain: 'x.test', captured_at: '2026-10-20T00:00:00Z',
  items: rows.map(([channel, status, more = {}], i) => ({ id: `E${String(i + 1).padStart(3, '0')}`, collector: 'owned', channel, status, finding: `${channel} ${status}.`, url: 'https://x.test/', captured_at: '2026-10-20T00:00:00Z', ...more })),
  ...extra,
});

test('channels we could not cover are named once, in the closing section, and get no activity row', () => {
  const { evidence, analysis } = load();
  const { html } = render(evidence, analysis);
  const gap = gapOf(html);
  for (const label of ['TikTok ads', 'Social (company)']) assert.ok(gap.includes(label), label);
  for (const label of ['Meta ads', 'LinkedIn ads', 'Google ads']) assert.ok(!gap.includes(label), `${label} was covered`);
  for (const label of ['Hiring', 'Site traffic', 'Martech']) assert.ok(!gap.includes(label), `${label} is context, not a growth channel, so it is never listed`);
  assert.equal((html.match(/<b>Not covered:<\/b>/g) ?? []).length, 1, 'named once');
  assert.ok(!/Channels not covered/.test(html), 'the old wording is gone');
});

test('"Not covered" lists a channel with only couldn\'t-check items, but not one with an observed or stated item or a recorded absence', () => {
  const ev = tiny([
    ['social', 'couldnt_check'],                  // only a failed check: not covered
    ['community', 'couldnt_check'],
    ['community', 'couldnt_check'],               // several failed checks are still not coverage
    ['video', 'observed'],                        // seen
    ['pricing_signup', 'stated'],                 // stated by the company
    ['comparison', 'observed', { absent: true, probe: 'Searched the sitemap for /vs/ and /compare/ paths' }], // a recorded absence is coverage
    ['open_source', 'couldnt_check'],
    ['open_source', 'observed'],                  // one observed item among failed ones is enough
  ]);
  const { html } = renderReport(ev, {}, { baseDir: '.' });
  const gap = gapOf(html);
  for (const label of ['Social (company)', 'Community']) assert.ok(gap.includes(label), `${label} should be listed`);
  assert.equal((gap.match(/Community/g) ?? []).length, 1, 'listed once although two items were unchecked');
  for (const label of ['YouTube & video', 'Pricing & signup', 'Comparison pages', 'Open source & dev community']) assert.ok(!gap.includes(label), `${label} was covered`);
  // The same channel is not covered in one run and covered in the next, depending only on the evidence.
  const covered = tiny([['social', 'couldnt_check'], ['social', 'observed']]);
  assert.ok(!gapOf(renderReport(covered, {}, { baseDir: '.' }).html).includes('Social (company)'));
});

test('"Not covered" never lists traffic, hiring or martech, even when they have only couldn\'t-check items or nothing at all', () => {
  const ev = tiny([['traffic', 'couldnt_check'], ['hiring', 'couldnt_check'], ['martech', 'couldnt_check'], ['social', 'couldnt_check']]);
  const gap = gapOf(renderReport(ev, {}, { baseDir: '.' }).html);
  assert.ok(gap.includes('Social (company)'));
  for (const label of ['Site traffic', 'Hiring', 'Martech']) assert.ok(!gap.includes(label), label);
  const none = gapOf(renderReport(tiny([]), {}, { baseDir: '.' }).html);
  for (const label of ['Site traffic', 'Hiring', 'Martech']) assert.ok(!none.includes(label), `${label} (no items at all)`);
  assert.ok(none.includes('Social (company)'), 'a channel with no items at all is not covered');
});

test('collected Google ads count as covering google_ads even with no google_ads evidence item', () => {
  const ads = [{ id: 'AD1', platform: 'google', format: 'text', days_shown: 30, first_shown: '2026-09-01', url: 'https://x.test/ad' }];
  const withAds = gapOf(renderReport(tiny([['social', 'couldnt_check']], { ads }), {}, { baseDir: '.' }).html);
  assert.ok(!withAds.includes('Google ads'));
  const without = gapOf(renderReport(tiny([['social', 'couldnt_check']]), {}, { baseDir: '.' }).html);
  assert.ok(without.includes('Google ads'));
});

test('activities we could not look at are never shown as absent: "Not covered", no "none found", named in the closing card', () => {
  const { evidence, analysis } = load();
  const { html } = renderReport(dropActivities(evidence, ['google_ads', 'pricing']), analysis, { baseDir: FIX });
  assert.ok(!/class="sbr ab/.test(html), 'no checked-absence rows without a recorded check');
  for (const id of ['google_ads', 'pricing']) {
    const pane = paneOf(html, id);
    assert.match(pane, /<span class="state state-none">Not covered<\/span>/);
    assert.ok(!/none found/i.test(pane));
  }
  const gaps = html.split('id="gaps"')[1].split('</section>')[0];
  assert.match(gaps, /<b>Activities not covered:<\/b>[^<]*Google ads[^<]*Pricing page[^<]*not the same as the company not doing it/);
});
test('empty sections are not printed', () => {
  const { evidence, analysis } = load();
  const { html } = render(evidence, analysis);
  assert.ok(!html.includes('Checked and not found'), 'no confirmed absences, so no heading');
});

// ---------- honesty rules ----------

test('a claim with no evidence ids is dropped and never shown', () => {
  const { evidence, analysis } = load();
  analysis.couldnt_see.push({ text: 'An unsupported hot take.', evidence_ids: [] });
  const { html, warnings } = render(evidence, analysis);
  assert.ok(!html.includes('unsupported hot take'));
  assert.ok(warnings.some((w) => /no evidence ids/.test(w)));
});

test('citing an unknown evidence id is a hard error', () => {
  const { evidence, analysis } = load();
  analysis.couldnt_see.push({ text: 'x', evidence_ids: ['E999'] });
  assert.throws(() => render(evidence, analysis), /unknown evidence id E999/);
});

test('a checked absence says "Checked, none found" in its block with what was checked', () => {
  const { evidence: full, analysis } = load();
  const evidence = dropActivities(full, ['comparison']); // the other comparison facts would make it "Seen"
  evidence.items.push({
    id: 'E100', collector: 'owned', channel: 'comparison', status: 'observed', absent: true,
    probe: 'Fetched notion.com/sitemap.xml (4,812 URLs) and searched for /vs/ and /compare/ paths',
    finding: 'No Notion-authored comparison pages in the sitemap.', url: 'https://www.notion.com/sitemap.xml',
    captured_at: '2026-10-20T03:00:00Z',
  });
  const { html } = renderReport(evidence, analysis, { baseDir: FIX });
  assert.ok(!html.includes('Checked and not found'), 'no separate absences list');
  const pane = paneOf(html, 'comparison');
  assert.match(pane, /<span class="state state-absent">Checked, none found<\/span>/);
  assert.match(pane, /<p class="facts muted">Checked: Fetched notion\.com\/sitemap\.xml/);
  // A block that only shows what we saw never claims a check it did not make.
  assert.ok(!/Checked: /.test(paneOf(html, 'pricing')));
});

test('a checked absence without a probe is rejected', () => {
  const { evidence, analysis } = load();
  evidence.items.push({
    id: 'E101', collector: 'owned', channel: 'comparison', status: 'observed', absent: true,
    finding: 'Nothing found.', url: 'https://www.notion.com/', captured_at: '2026-10-20T03:00:00Z',
  });
  assert.throws(() => render(evidence, analysis), /needs status "observed" and a "probe"/);
});

// ---------- ads ----------

test('ad strip: previews only, longest-running first, capped at STRIP_MAX, no hidden tiles', () => {
  const { evidence, analysis } = load();
  const { html } = render(evidence, analysis);
  const pane = paneOf(html, 'google_ads');
  const strip = stripOf(pane);
  const cards = adCards(strip);
  const previews = evidence.ads.filter(hasPreview);
  assert.equal(cards.length, Math.min(previews.length, STRIP_MAX));
  assert.equal(stripItems(strip).length, cards.length);
  assert.match(strip, /Longest-running ads first/);
  const days = cards.map((c) => Number(c.match(/<b>(\d+) days<\/b>/)[1]));
  assert.deepEqual(days, [...days].sort((a, b) => b - a));
  assert.deepEqual(days, previews.map((a) => a.days_shown).sort((a, b) => b - a).slice(0, STRIP_MAX), 'it is the longest-running ads that are kept');
  for (const c of cards) assert.match(c, /<img[^>]*\ssrc="https:/, 'every ad tile has its preview');
  assert.ok(!pane.includes(' hidden'), 'nothing is hidden or deferred inside the ad pane');
  assert.match(strip, /class="strip-nav"/, 'long strips get scroll arrows');
});

test('ads without a usable preview are counted in a line, not drawn as tiles', () => {
  const { evidence, analysis } = load();
  const { html } = render(evidence, analysis);
  const rest = evidence.ads.filter((a) => !hasPreview(a));
  assert.ok(rest.length > 0);
  const pane = paneOf(html, 'google_ads');
  assert.match(pane, new RegExp(`We collected ${evidence.ads.length}; ${rest.length} of the company(?:'|&#39;)s ads ${rest.length === 1 ? 'has' : 'have'} no preview from Google`));
  const strip = stripOf(pane);
  for (const a of rest) assert.ok(!strip.includes(a.url), 'an ad with no preview is not a tile');
  assert.ok(!/class="thumb textad"/.test(strip));
  assert.ok(!html.includes('class="adlist"'));
});

test('tiny "previews" (often Google UI wrappers) are treated as no preview', () => {
  assert.equal(hasPreview({ image_url: 'https://tpc.googlesyndication.com/x', width: 175 }), false);
  assert.equal(hasPreview({ image_url: 'https://tpc.googlesyndication.com/x', width: 348 }), true);
  assert.equal(hasPreview({ image_url: 'https://tpc.googlesyndication.com/x', width: null }), true);
  assert.equal(hasPreview({ image_url: null, width: 600 }), false);
});

test('with no ad data the google_ads block has no strip and still points at the ad libraries', () => {
  const { evidence, analysis } = load();
  evidence.ads = [];
  const { html } = render(evidence, analysis);
  const pane = paneOf(html, 'google_ads');
  assert.equal(stripOf(pane), '');
  assert.ok(!pane.includes('We collected'), 'no count of ads we did not collect');
  assert.match(pane, /adstransparency\.google\.com\/\?region=anywhere&amp;domain=notion\.com/);
  assert.deepEqual([...kfRows(pane).keys()], ['Ad libraries'], 'the only fact is where to look further');
  assert.match(kfRows(pane).get('Ad libraries'), /adstransparency\.google\.com/);
});

// ---------- funnel and images ----------

test('screenshots sit in the strip of the activity they show, each with a zoom button and a link to its page', () => {
  const { evidence, analysis } = load();
  const { html } = render(evidence, analysis);
  assert.equal((html.match(/src="data:image\/png;base64,/g) ?? []).length, 2);
  assert.equal((html.match(/<figure class="xshot[ "]/g) ?? []).length, 2, 'each screenshot is drawn once, wherever it fits best');
  for (const m of html.matchAll(/<figure class="xshot[^"]*">[\s\S]*?<\/figure>/g)) {
    assert.match(m[0], /<button class="frame" type="button" data-zoom aria-label="Enlarge the [^"]+">/);
    assert.match(m[0], /<a class="ext" href="https:\/\/www\.notion\.com[^"]*"[^>]*aria-label="Open the live /);
  }
  // Every screenshot is inside an activity pane's strip.
  const shots = html.split('<div class="strip">').slice(1).filter((x) => x.split('</div></div>')[0].includes('class="xshot'));
  assert.equal(shots.length, 2);
  assert.ok(stripOf(paneOf(html, 'pricing')).includes('k-pricing'), 'the pricing screenshot is in the pricing pane');
  assert.ok(stripOf(paneOf(html, 'signup_entry')).includes('k-home'), 'the homepage screenshot is in the signup/entry pane');
  assert.ok(!html.includes('class="step missing"'));
});

test('image paths cannot escape the report folder', () => {
  const { evidence, analysis } = load();
  evidence.items.find((i) => i.funnel_step === 'home').image = '../../../../etc/hosts.png';
  const { html, warnings } = render(evidence, analysis);
  assert.ok(warnings.some((w) => /escapes the report folder/.test(w)));
  assert.equal((html.match(/src="data:image/g) ?? []).length, 1);
  assert.ok(!html.includes('etc/hosts'), 'the bad path is never embedded');
});

// ---------- safety ----------

test('the CSP script hash matches the inline script exactly', () => {
  const { evidence, analysis } = load();
  const { html } = render(evidence, analysis);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const hash = createHash('sha256').update(script).digest('base64');
  assert.ok(html.includes(`script-src 'sha256-${hash}'`));
  assert.equal((html.match(/<script/g) ?? []).length, 1, 'scraped content must never add a script tag');
});

test('hostile text is escaped and cannot add elements', () => {
  const { evidence, analysis } = load();
  analysis.reads = [{ activity: 'google_ads', read: '<img src=x onerror=alert(1)> <script>alert(2)</script> "quoted"', evidence_ids: [evidence.items[0].id] }];
  analysis.company.name = 'Evil $& Corp';
  const { html } = render(evidence, analysis);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.equal((html.match(/<script/g) ?? []).length, 1);
  assert.match(html, /<title>How Evil \$&amp; Corp grows · Growth Sneak<\/title>/);
});

test('non-http links are rejected', () => {
  const { evidence, analysis } = load();
  evidence.items[0].url = 'javascript:alert(1)';
  assert.throws(() => render(evidence, analysis), /http\(s\) link/);
});

test('the page names no scorer and advertises no unconnected sources', () => {
  const { evidence, analysis } = load();
  const { html } = render(evidence, analysis);
  assert.ok(!/Scores by|Jev|TypeSafe/.test(html.replace(/data:[^"')]+/g, '')));
  assert.ok(!/Not connected|would add|Made with Growth Sneak|Cost: \d/.test(html));
});

// ---------- structured tables ----------

// ---------- structured data now shown only as plain facts ----------

test('the content and SEO block has no site-section bars, languages or "What they publish" chart; the data is still validated', () => {
  const { evidence, analysis } = load();
  const { html } = render(evidence, analysis);
  const pane = paneOf(html, 'seo_content');
  assert.ok(!/sb-row|sb-new|What they publish|[0-9]+ smaller sections?/.test(html.split('<main')[1]), 'site bars are gone');
  assert.ok(!pane.includes('<details') && !pane.includes('<table'));
  evidence.site.sections = [{ urls: 'many' }];
  assert.throws(() => render(evidence, analysis), /site: each section needs "path" and a numeric "urls"/);
});

test('readiness checks (in the AI search pane) are words, never colour alone, and unknown reads "Couldn\'t check"', () => {
  const { evidence, analysis } = load();
  evidence.site_checks.checks.push({ check: 'Sitemap reachable', result: 'unknown', detail: 'Timed out' });
  const html = paneOf(render(evidence, analysis).html, 'aeo');
  assert.match(html, /<span class="gl gl-yes" aria-hidden="true">✓<\/span>/);
  assert.match(html, /<b>Sitemap reachable<\/b><span class="sr-only">: Couldn't check<\/span><span class="ckd">Timed out<\/span>/);
});

test('tech stack lists only tool names as chips; no categories, notes, table or claim of "no pixels"', () => {
  const { evidence, analysis } = load();
  const { html } = render(evidence, analysis);
  const tech = sectionOf(html, 'tech');
  assert.match(tech, /<ul class="chips"><li>Transcend<\/li><li>Sentry<\/li><li>Splunk<\/li><li>Contentful<\/li><li>Google sign-in<\/li><\/ul>/);
  assert.ok(!/<table|<th|Consent|Monitoring|Sign-in &amp; payments/.test(tech), 'no category labels');
  assert.ok(!/No pixels|No advertising pixels/i.test(tech), 'no claim of absent pixels');
});

test('pricing has no section of its own; the plans are one plain line in the pricing block, and no table', () => {
  const { evidence, analysis } = load();
  const { html } = render(evidence, analysis);
  assert.ok(!html.includes('id="funnel"') && !html.includes('id="pricing"'));
  const pane = paneOf(html, 'pricing');
  // Each plan is a labelled row: the plan name, then its price (and unit, and the button text when there is one).
  const rows = kfRows(pane);
  assert.deepEqual([...rows.keys()], ['Free', 'Plus', 'Business', 'Enterprise']);
  assert.equal(rows.get('Free'), '<b>$0</b> <span class="muted">per seat / month</span> <span class="muted">· “Sign up”</span>');
  assert.match(rows.get('Plus'), /^<b>\$10<\/b> <span class="muted">per seat \/ month<\/span>/);
  assert.match(rows.get('Business'), /^<b>\$20<\/b>/);
  assert.equal(rows.get('Enterprise'), '<b>Custom pricing</b> <span class="muted">· “Contact Sales”</span>', 'no unit is invented for a custom price');
  assert.ok(!/<p class="facts">/.test(pane), 'not a prose line');
  assert.ok(!/<table|The plans|Headline features/.test(html), 'no plans table, no features table');
});

test('the ad blocks list the ads we collected as a strip and a count, with no timeline, no mix table and no zero-month rows', () => {
  const { evidence, analysis } = load();
  const { html } = render(evidence, analysis);
  assert.ok(!/When the ads we collected started|<th scope="row">[A-Z][a-z]{2} \d{4}<|class="bar"|<td>Video<\/td>|Median days live/.test(html));
  assert.ok(!paneOf(html, 'google_ads').includes('<table'));
  assert.match(paneOf(html, 'google_ads'), new RegExp(`We collected ${evidence.ads.length}`));
});

test('a table that points at a missing evidence item fails the build', () => {
  const { evidence, analysis } = load();
  evidence.pricing.evidence_id = 'E999';
  assert.throws(() => render(evidence, analysis), /pricing: "evidence_id" must name an existing evidence item/);
});

test('reports without the structured data still render (all tables are optional)', () => {
  const { evidence, analysis } = load();
  delete evidence.site; delete evidence.site_checks; delete evidence.tech; delete evidence.pricing;
  const { html } = render(evidence, analysis);
  assert.ok(!html.includes('class="sb-row"'), 'no section bars without site data');
  assert.ok(!html.includes('Search and AI readiness'));
  assert.ok(!html.includes('<h3>Plans'));
});

test('comparison and customer-story pages are plain link lines of facts, labelled by page name, and non-http links are left out', () => {
  const { evidence, analysis } = load();
  evidence.site.page_types = {
    comparison: { urls: 3, examples: ['https://www.notion.com/vs/evernote', 'https://www.notion.com/compare-against/trello', 'javascript:alert(1)'] },
    customers: { urls: 3, examples: ['https://www.notion.com/customers', 'https://www.notion.com/customers/figma-case-study'] },
  };
  const { html } = render(evidence, analysis);
  const cmp = paneOf(html, 'comparison');
  assert.match(kfRows(cmp).get('Pages'), /^<span class="pills"><a class="lpill" href="https:\/\/www\.notion\.com\/vs\/evernote" target="_blank" rel="noopener noreferrer">Evernote<\/a><a class="lpill" href="https:\/\/www\.notion\.com\/compare-against\/trello"[^>]*>Trello<\/a><\/span>$/);
  assert.ok(!cmp.includes('javascript:'));
  const cust = paneOf(html, 'customer_proof');
  assert.match(kfRows(cust).get('Stories'), /^<span class="pills"><a class="lpill" href="https:\/\/www\.notion\.com\/customers\/figma-case-study"[^>]*>Figma Case Study<\/a><\/span>$/);
  assert.ok(!/customers"[^>]*>Customers</.test(cust), 'the index page is not a story');
});

test('linkRow: a page already drawn as a screenshot is not repeated as a link; what is left is still listed once', () => {
  const { evidence, analysis } = load();
  evidence.screens = [
    { kind: 'comparison', page_url: 'https://www.notion.com/vs/evernote/?ref=nav', image: 'assets/home.png', caption: 'Evernote comparison', evidence_id: 'E008' },
    { kind: 'customers', page_url: 'https://www.notion.com/customers/figma-case-study', image: 'assets/pricing.png', caption: 'Figma story', evidence_id: 'E009' },
  ];
  evidence.site.page_types = {
    comparison: { urls: 3, examples: ['https://www.notion.com/vs/evernote', 'https://www.notion.com/vs/trello', 'https://www.notion.com/vs/trello/', 'https://www.notion.com/VS/Trello#top'] },
    customers: { urls: 2, examples: ['https://www.notion.com/customers/figma-case-study'] },
  };
  const { html } = render(evidence, analysis);
  const cmp = paneOf(html, 'comparison');
  assert.ok(stripOf(cmp).includes('<figure class="xshot'), 'the Evernote page is shown as a screenshot');
  const pages = kfRows(cmp).get('Pages');
  assert.ok(!/evernote/i.test(pages), 'so it is not also a link (trailing slash, query and case ignored when comparing)');
  assert.equal((pages.match(/<a /g) ?? []).length, 1, 'Trello is listed once although three spellings were collected');
  assert.match(pages, />Trello<\/a><\/span>$/);
  // When every page is already a screenshot, the row is dropped rather than left empty.
  const cust = paneOf(html, 'customer_proof');
  assert.ok(stripOf(cust).includes('<figure class="xshot'));
  assert.equal(kfRows(cust).has('Stories'), false);
  assert.ok(!/<dl class="kf">/.test(cust), 'no empty fact list');
  // The same page appears as a screenshot or a link, never both, anywhere on the page.
  const shotPages = new Set([...html.matchAll(/<figure class="xshot[^"]*">[\s\S]*?<a class="ext" href="([^"]+)"/g)].map((m) => m[1].replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase()));
  for (const m of cmp.matchAll(/<dd>([\s\S]*?)<\/dd>/g)) for (const l of m[1].matchAll(/href="([^"]+)"/g)) assert.ok(!shotPages.has(l[1].replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase()), `${l[1]} is both`);
});

test('comparison links: real /compare, /vs, /versus and /alternatives pages win over blog posts with "vs" in the slug; blogs are the fallback only when no real page exists', () => {
  const { evidence, analysis } = load();
  const row = (examples) => {
    evidence.site.page_types = { comparison: { urls: examples.length, examples } };
    return kfRows(paneOf(render(evidence, analysis).html, 'comparison')).get('Pages') ?? '';
  };
  const hrefs = (html) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  const mixed = row([
    'https://www.notion.com/blog/notion-vs-evernote',
    'https://www.notion.com/vs/evernote',
    'https://www.notion.com/guides/asana-vs-trello',
    'https://www.notion.com/compare/asana',
    'https://www.notion.com/versus/coda',
    'https://www.notion.com/alternatives/airtable',
    'https://www.notion.com/alternative/obsidian',
    'https://www.notion.com/compare-against/trello',
    'https://www.notion.com/vsco',
  ]);
  assert.deepEqual(hrefs(mixed), [
    'https://www.notion.com/vs/evernote',
    'https://www.notion.com/compare/asana',
    'https://www.notion.com/versus/coda',
    'https://www.notion.com/alternatives/airtable',
    'https://www.notion.com/alternative/obsidian',
    'https://www.notion.com/compare-against/trello',
  ], 'blog posts and /vsco are dropped; real pages keep their order');
  assert.ok(!/blog|guides/.test(mixed));
  // Only blog posts: they are better than nothing, so they stay.
  const blogsOnly = row(['https://www.notion.com/blog/notion-vs-evernote', 'https://www.notion.com/guides/asana-vs-trello']);
  assert.deepEqual(hrefs(blogsOnly), ['https://www.notion.com/blog/notion-vs-evernote', 'https://www.notion.com/guides/asana-vs-trello']);
  // Non-http links never get through, even beside real pages.
  assert.ok(!/javascript:/.test(row(['javascript:alert(1)', 'https://www.notion.com/vs/evernote'])));
});

test('open-source stars of null are not shown as zero', () => {
  const { evidence, analysis } = load();
  evidence.oss = { ...(evidence.oss ?? { org: 'x', url: 'https://github.com/x', repos: 44, top: [{ name: 'a', url: 'https://github.com/x/a', stars: 48, pushed: '2026-09-01' }], evidence_id: evidence.items[0].id }), stars: null, repos: 44 };
  const { html } = render(evidence, analysis);
  assert.ok(!/\b0 stars across/.test(html));
  // A single repo whose stars are unknown is left out of the bars, not drawn as 0 stars.
  evidence.oss.top = [...evidence.oss.top, { name: 'mystery-repo', url: 'https://github.com/x/mystery-repo', stars: null, pushed: '2026-09-01' }];
  const h2 = render(evidence, analysis).html;
  assert.ok(!h2.includes('mystery-repo'), 'a repo with unknown stars is not shown as 0');
  assert.ok(!/\bNaN\b|undefined|null stars/.test(html.split('<main')[1].replace(/data:image[^"']*/g, '')));
});

test('with no ads the paid blocks are short, and say what was or was not collected', () => {
  const { evidence, analysis } = load();
  evidence.ads = [];
  const { html } = render(evidence, analysis);
  const g = paneOf(html, 'google_ads');
  assert.equal(stripOf(g), '');
  assert.ok(!g.includes('<table'), 'no table for an empty state');
  assert.ok(g.length < 3500);
  // Paid social has no collected data at all: no strip, no number from nowhere, only ways to look further.
  const ps = paneOf(html, 'paid_social');
  assert.equal(stripOf(ps), '');
  assert.deepEqual([...kfRows(ps).keys()], ['Ad libraries']);
  assert.ok(!/We collected/.test(ps));
});

// ---------- examples: caps, no repeats, no examples for what was not covered ----------

const FIXTURES = ['notion.com', 'exa.ai'];
const FIX_DIR = (name) => join(dirname(fileURLToPath(import.meta.url)), 'fixtures', name);
const loadFix = (name) => {
  const dir = FIX_DIR(name);
  return { dir, evidence: JSON.parse(readFileSync(join(dir, 'evidence.json'), 'utf8')), analysis: JSON.parse(readFileSync(join(dir, 'analysis.json'), 'utf8')) };
};

test('every strip stays within STRIP_MAX, and no post, ad or screenshot is drawn twice anywhere on the page', () => {
  for (const name of FIXTURES) {
    const { dir, evidence, analysis } = loadFix(name);
    const { html } = renderReport(evidence, analysis, { baseDir: dir });
    const strips = html.split('<div class="strip">').slice(1);
    assert.ok(strips.length > 0, `${name} has strips`);
    for (const st of strips) {
      const n = stripItems(st.split('<details')[0].split('<div class="stagecard"')[0].split('<div class="sc-detail"')[0]).length;
      assert.ok(n >= 1 && n <= STRIP_MAX, `${name}: a strip has ${n} items`);
    }
    const posts = [...html.matchAll(/<article class="xpost[^"]*">[\s\S]*?<a class="ext" href="([^"]+)"/g)].map((m) => m[1]);
    const ads = [...html.matchAll(/<figure class="xad"><a class="thumb[^"]*" href="([^"]+)"/g)].map((m) => m[1]);
    const imgs = [...html.matchAll(/<figure class="(?:xad|xshot[^"]*)">[\s\S]*?<img[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);
    const shotPages = [...html.matchAll(/<figure class="xshot[^"]*">[\s\S]*?<a class="ext" href="([^"]+)"/g)].map((m) => m[1]);
    for (const [label, list] of [['post', posts], ['ad', ads], ['image', imgs], ['screenshot page', shotPages]]) {
      assert.equal(new Set(list).size, list.length, `${name}: a ${label} is drawn twice`);
    }
    assert.ok(posts.length + ads.length + imgs.length > 0);
  }
});

test('blocks of activities we could not cover contain no strip and no number', () => {
  for (const name of FIXTURES) {
    const { dir, evidence, analysis } = loadFix(name);
    const gone = ['google_ads', 'organic_social', 'pricing', 'founder_social', 'seo_content'];
    const { html } = renderReport(dropActivities(evidence, gone), analysis, { baseDir: dir });
    for (const id of gone) {
      const pane = paneOf(html, id);
      assert.equal(stripOf(pane), '', `${name}/${id}: no strip`);
      assert.ok(!pane.includes('class="strip'), `${name}/${id}: no strip markup`);
      assert.ok(!pane.includes('<details'), `${name}/${id}: no folds, charts or tables`);
      assert.match(pane, /<span class="state state-none">Not covered<\/span>/);
      const text = pane.slice(pane.indexOf('>') + 1).replace(/<[^>]+>/g, ' ').replace(/&#?\w+;/g, '');
      assert.ok(!/\d/.test(text), `${name}/${id}: no number in the pane text: ${text.replace(/\s+/g, ' ').slice(0, 160)}`);
    }
  }
});

// ---------- analysis fields the report no longer shows ----------

const UNUSED_FIELDS = ['channels', 'connections', 'notable_plays', 'messaging', 'timeline', 'not_doing', 'recent_changes', 'engine', 'profile', 'activities'];

test('analysis fields the report no longer shows are ignored, even when broken: a bad activities entry or an unknown channel does not break the render or add a warning', () => {
  for (const name of FIXTURES) {
    const { dir, evidence, analysis } = loadFix(name);
    const opts = { baseDir: dir };
    const clean = structuredClone(analysis);
    for (const k of UNUSED_FIELDS) delete clean[k];
    const base = renderReport(evidence, clean, opts);
    // The fixtures still carry some of the old fields; they change nothing.
    const asShipped = renderReport(evidence, analysis, opts);
    assert.equal(asShipped.html, base.html, `${name}: old fields in the fixture are ignored`);
    assert.deepEqual(asShipped.warnings, base.warnings);
    const junk = structuredClone(clean);
    junk.channels = [{ channel: 'not_a_channel', strength: 'bogus', read: 'x', evidence_ids: ['E999'] }, { channel: 'social', strength: 'heavy', read: 'Very active.', evidence_ids: [] }];
    junk.not_doing = [{ text: 'They do not run TikTok ads.', evidence_ids: ['E999'] }];
    junk.activities = [{ channel: 'nope', kind: 'weird', date: 'someday', title: 'A dated row.', evidence_ids: ['E999'], exhibits: [{ type: 'post', id: 'P999' }] }];
    junk.timeline = [{ date: 'someday', channel: 'nope', title: 'x', evidence_ids: ['E999'] }];
    junk.messaging = [{ theme: 'x', examples: [{ quote: 'q', url: 'javascript:alert(1)', evidence_ids: ['E999'] }] }];
    junk.notable_plays = [{ text: 'A hot take.', evidence_ids: [], exhibits: [{ type: 'video', id: 'V1' }] }];
    junk.engine = 'not an object'; junk.profile = 7; junk.connections = null; junk.recent_changes = 'x';
    const r = renderReport(evidence, junk, opts);
    assert.equal(r.html, base.html, `${name}: the unused fields change nothing on the page`);
    assert.deepEqual(r.warnings, base.warnings, `${name}: and raise no warning`);
    for (const t of ['Very active.', 'A dated row.', 'A hot take.', 'They do not run TikTok ads.']) assert.ok(!r.html.includes(t), t);
  }
});

test('the fields the report does read are still checked: an uncited read is dropped and a bad evidence id stops the build', () => {
  const { evidence, analysis } = loadFix('exa.ai');
  const opts = { baseDir: FIX_DIR('exa.ai') };
  const a = structuredClone(analysis);
  a.reads = [{ activity: 'google_ads', read: 'Uncited read.', evidence_ids: [] }];
  const r = renderReport(evidence, a, opts);
  assert.ok(!r.html.includes('Uncited read.'));
  assert.equal(r.warnings.filter((w) => /no evidence ids/.test(w)).length, 1);
  a.reads = [{ activity: 'google_ads', read: 'A read.', evidence_ids: ['E999'] }];
  assert.throws(() => renderReport(evidence, a, opts), /reads: cites unknown evidence id E999/);
});
