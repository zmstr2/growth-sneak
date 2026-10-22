import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderReport } from '../scripts/render.mjs';
import { allScores, paneOf, stripOf, stripItems } from './helpers.mjs';
import { SECTIONS } from '../scripts/scoreboard.mjs';
import { STRIP_MAX } from '../scripts/proof.mjs';
import { discoverAccounts, engagementOf, accountStats, median, MIN_POSTS_FOR_BASELINE } from '../scripts/social.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'exa.ai');
const load = () => ({
  evidence: JSON.parse(readFileSync(join(FIX, 'evidence.json'), 'utf8')),
  analysis: JSON.parse(readFileSync(join(FIX, 'analysis.json'), 'utf8')),
});
const render = (ev, an) => renderReport(ev, an, { baseDir: FIX, scores: allScores(ev) });

// ---------- collector helpers ----------

test('discovers accounts from homepage links and JSON-LD sameAs, ignoring share links', () => {
  const html = `<a href="https://x.com/exaailabs">X</a><a href="https://twitter.com/intent/tweet?text=hi">share</a>
    <a href="https://www.linkedin.com/company/exa-ai/">in</a><a href="https://github.com/exa-labs">gh</a>
    <a href="https://discord.gg/HCShtBqbfV">dc</a>
    <script type="application/ld+json">{"@type":"Organization","sameAs":["https://www.youtube.com/@exa-ai","https://x.com/ExaAILabs"]}</script>`;
  const a = discoverAccounts(html);
  assert.deepEqual(a.map((x) => `${x.platform}:${x.handle}`), ['discord:HCShtBqbfV', 'github:exa-labs', 'linkedin:company/exa-ai', 'x:exaailabs', 'youtube:@exa-ai']);
});

test('engagement is comparable within a platform', () => {
  assert.equal(engagementOf({ platform: 'x', metrics: { likes: 10, reposts: 2, replies: 3 } }), 15);
  assert.equal(engagementOf({ platform: 'linkedin', metrics: { reactions: 40, comments: 2 } }), 42);
  assert.equal(engagementOf({ platform: 'hn', metrics: { points: 30, comments: 5 } }), 35);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 10]), 2.5);
});

test('outliers need a baseline of at least 5 posts and 2× the median', () => {
  const mk = (n, likes) => Array.from({ length: n }, (_, i) => ({ platform: 'x', account: 'a', owner: 'company', url: `https://x.com/a/${i}`, published: '2026-10-01', metrics: { likes: likes[i] ?? 10 } }));
  const few = accountStats(mk(MIN_POSTS_FOR_BASELINE - 1, [10, 10, 10, 500]));
  assert.equal(few[0].baseline_ok, false);
  assert.equal(few[0].outliers.length, 0, 'no ratio claims from a tiny sample');
  const ok = accountStats(mk(6, [10, 10, 10, 10, 19, 500]));
  assert.equal(ok[0].baseline_ok, true);
  assert.deepEqual(ok[0].outliers.map((p) => p.engagement), [500], '19 is under 2× the median of 10');
});

// ---------- report ----------

test('the Exa sample renders every section without adjustments', () => {
  const { evidence, analysis } = load();
  const { html, warnings } = render(evidence, analysis);
  assert.ok(html.includes('<header id="summary"'), 'missing summary');
  for (const id of ['tech', 'gaps']) assert.ok(html.includes(`<section id="${id}"`), `missing ${id}`);
  for (const sec of SECTIONS) assert.ok(html.includes(`<section id="s-${sec.id}"`), `missing s-${sec.id}`);
  assert.deepEqual(warnings, []);
});

test('social blocks: native post cards in a strip of at most STRIP_MAX, no account dot-plot, no posting-frequency claims, no post drawn twice, company and founder not mixed', () => {
  const { evidence, analysis } = load();
  const { html } = render(evidence, analysis);
  const company = paneOf(html, 'organic_social'), founder = paneOf(html, 'founder_social');
  assert.ok(!/How their accounts perform|class="dp-row"|dp-med/.test(html.split('<main')[1]), 'the account dot-plot and its fold are gone');
  assert.ok(!company.includes('<details') && !founder.includes('<details'));
  const cards = stripItems(stripOf(company));
  assert.ok(cards.length >= 1 && cards.length <= STRIP_MAX);
  assert.equal(cards.length, (stripOf(company).match(/<article class="xpost nat /g) ?? []).length, 'every company post is a native LinkedIn or X card');
  assert.match(stripOf(company), /<span class="plat plat-(li|x)"/);
  assert.ok(!/\/wk/.test(company + founder), 'no posting-frequency claims from a capped sample');
  // a post is never drawn twice on the page
  const urls = [...html.matchAll(/<article class="xpost[^"]*">[\s\S]*?<a class="ext" href="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(urls).size, urls.length, 'a post card appears twice');
  // company posts are not mixed with the founder's
  assert.ok(!/<span class="sub">Founder · /.test(stripOf(company)));
  assert.ok(!/<span class="sub">Company page · /.test(stripOf(founder)));
});

test('a post pointing at missing evidence fails the build', () => {
  const { evidence, analysis } = load();
  const bad = structuredClone(evidence);
  bad.posts[0].evidence_id = 'E999';
  assert.throws(() => render(bad, analysis), /posts\[0\]: "evidence_id" must name an existing evidence item/);
});

// ---------- fixes from the first end-to-end run (attio.com) ----------
import { MIN_OUTLIER_ENGAGEMENT } from '../scripts/social.mjs';

test('a big ratio on a tiny base is not an outlier (37 likes vs a usual 5)', () => {
  const mk = (likes) => likes.map((l, i) => ({ platform: 'x', account: 'a', owner: 'company', url: `https://x.com/a/${i}`, published: '2026-10-01', metrics: { likes: l } }));
  const small = accountStats(mk([5, 5, 5, 5, 6, 37]));
  assert.equal(small[0].outliers.length, 0, '8x usual but only 37 engagements');
  const big = accountStats(mk([5, 5, 5, 5, 6, MIN_OUTLIER_ENGAGEMENT + 10]));
  assert.equal(big[0].outliers.length, 1);
});

test('a long ad history draws no timeline rows at all (the by-quarter chart was removed); the count line stays honest', () => {
  const { evidence, analysis } = load();
  evidence.ads = [
    { id: 'AD1', platform: 'google', format: 'text', days_shown: 1288, first_shown: '2023-04-12', url: 'https://x.com/1' },
    { id: 'AD2', platform: 'google', format: 'text', days_shown: 16, first_shown: '2026-10-06', url: 'https://x.com/2' },
  ];
  const { html } = render(evidence, analysis);
  const pane = paneOf(html, 'google_ads');
  assert.ok(!/<th scope="row">|class="bar"|Q[1-4]/.test(pane), 'no timeline of any granularity');
  assert.equal(stripOf(pane), '', 'neither ad has a preview, so no tile is drawn');
  assert.match(pane, /We collected 2; 2 of the company(?:'|&#39;)s ads have no preview from Google\./);
});

test('old ads carry their year; this year\'s do not', () => {
  const { evidence, analysis } = load();
  evidence.ads = [
    { id: 'AD1', platform: 'google', format: 'text', days_shown: 1288, first_shown: '2023-04-12', image_url: 'https://tpc.googlesyndication.com/a', width: 348, url: 'https://x.com/1' },
    { id: 'AD2', platform: 'google', format: 'text', days_shown: 16, first_shown: '2026-10-06', image_url: 'https://tpc.googlesyndication.com/b', width: 348, url: 'https://x.com/2' },
  ];
  const { html } = render(evidence, analysis);
  assert.match(html, /since 12 Apr 2023/);
  assert.match(html, /since 6 Oct<\/figcaption>/);
});

test('accounts: no double @, no "(inferred…)" labels, accounts with no numbers are not drawn as rows, no 0-member Discord', () => {
  const { evidence, analysis } = load();
  evidence.accounts.push(
    { platform: 'youtube', handle: '@attiocrm', url: 'https://www.youtube.com/@attiocrm', owner: 'company', followers: null, evidence_id: 'E015' },
    { platform: 'linkedin', handle: 'in/nicolas-sharp (inferred from text)', url: 'https://www.linkedin.com/in/nicolas-sharp', owner: 'founder', followers: null, evidence_id: 'E016' },
  );
  evidence.community.discord = { evidence_id: 'E020', name: 'x', members: 0, online: 0 };
  const { html } = render(evidence, analysis);
  const social = paneOf(html, 'organic_social') + paneOf(html, 'founder_social') + paneOf(html, 'community');
  assert.ok(!social.includes('@@'), 'double @');
  assert.ok(!/inferred from text/.test(social));
  assert.ok(!/attiocrm[^<]*\b0 followers/.test(social), 'an account with unknown followers is never shown as 0');
  assert.ok(!/\b0 Discord members|Discord members, 0 online/.test(html), 'a Discord with 0 members must not be shown as a count');
});

test('screenshot captions do not repeat the page name', () => {
  const { evidence, analysis } = load();
  evidence.items.find((i) => i.funnel_step === 'home').finding = 'Homepage headline: "Welcome". Two buttons.';
  const { html } = render(evidence, analysis);
  assert.match(html, /<b>Homepage\.<\/b>/);
  assert.ok(!/<b>Homepage\.<\/b> Homepage/.test(html), 'the label is not repeated in the caption');
  assert.ok(!/Two buttons/.test(html.split('class="xshot k-home"')[1].split('</figure>')[0]), 'captions stay short: first clause only');
});
