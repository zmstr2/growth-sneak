import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderReport } from '../scripts/render.mjs';
import { emphasize, esc } from '../scripts/util.mjs';
import { postCard, metricParts } from '../scripts/exhibits.mjs';
import { accountStats, hasMetrics, engagementOf } from '../scripts/social.mjs';
import { merge } from '../scripts/merge.mjs';
import { updatesByMonth } from '../scripts/sitemap.mjs';
import { allScores, paneOf, stripOf, stripItems, sectionOf } from './helpers.mjs';
import { SECTIONS } from '../scripts/scoreboard.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'exa.ai');
const load = () => ({
  evidence: JSON.parse(readFileSync(join(FIX, 'evidence.json'), 'utf8')),
  analysis: JSON.parse(readFileSync(join(FIX, 'analysis.json'), 'utf8')),
});
const render = (ev, an, over) => renderReport(ev, an, { baseDir: FIX, scores: allScores(ev, over) });

// ---------- typography that points ----------

test('figures get a highlighter; digits inside entities and ids are left alone', () => {
  const out = emphasize(esc("It's $2.6M, 60,120 followers, 97% and 7 comparison pages; see E012 and A&B"));
  assert.match(out, /<b class="fig">\$2\.6M<\/b>/);
  assert.match(out, /<b class="fig">60,120<\/b>/);
  assert.match(out, /<b class="fig">97%<\/b>/);
  assert.match(out, /<b class="fig">7 comparison pages<\/b>/);
  assert.ok(out.includes('it&#39;s') || out.includes('It&#39;s'), 'entity kept intact');
  assert.ok(!/E<b/.test(out), 'ids are not highlighted');
});

// ---------- post numbers are never invented ----------

test('a post without readable numbers says so and is never drawn with a zero', () => {
  const p = { id: 'P1', platform: 'linkedin', account: 'in/jane', owner: 'founder', url: 'https://www.linkedin.com/posts/x', published: '2026-10-13', text: 'Hello world', metrics: {} };
  assert.equal(hasMetrics(p), false);
  const html = postCard(p);
  assert.match(html, /Engagement not visible/);
  assert.ok(!/<b>0<\/b>/.test(html));
  assert.deepEqual(metricParts(p), []);
});

// ---------- native-looking LinkedIn and X cards ----------

const Y = { asOfYear: 2026 };
const li = (over = {}) => ({ id: 'P1', platform: 'linkedin', account: 'in/jane-doe', owner: 'founder', url: 'https://www.linkedin.com/posts/jane_x', published: '2026-10-13', text: 'We shipped it.', metrics: { reactions: 1234, comments: 56 }, ...over });

test('native LinkedIn card: avatar initials, role line by owner, date, sr-only metric labels, decorative action row, View post link', () => {
  const html = postCard(li(), Y);
  assert.match(html, /^<article class="xpost nat li">/);
  assert.match(html, /<span class="av" aria-hidden="true">JD<\/span>/, 'initials of the account name, hidden from screen readers');
  assert.match(html, /<b>jane-doe<\/b><span class="sub">Founder · 13 Oct<\/span>/, 'a founder is called a Founder');
  assert.match(postCard(li({ owner: 'company', account: 'company/exa-ai' }), Y), /<span class="av" aria-hidden="true">EA<\/span>[\s\S]*Company page · 13 Oct/);
  assert.match(postCard(li({ owner: 'employee' }), Y), /Team member · 13 Oct/);
  assert.match(html, /<b>1,234<\/b><span class="sr-only"> reactions<\/span>/);
  assert.match(html, /<b>56<\/b><span class="sr-only"> comments<\/span>/);
  assert.equal((html.match(/<svg class="mi" viewBox="0 0 24 24" aria-hidden="true">/g) ?? []).length, 2, 'one decorative icon per metric');
  assert.match(html, /<span class="acts" aria-hidden="true"><span>Like<\/span><span>Comment<\/span><span>Repost<\/span><span>Send<\/span><\/span>/, 'the Like/Comment row is decorative, not buttons');
  assert.ok(!/<button/.test(html), 'nothing on the card pretends to be interactive');
  assert.match(html, /<a class="ext" href="https:\/\/www\.linkedin\.com\/posts\/jane_x" target="_blank" rel="noopener noreferrer" aria-label="Open this LinkedIn post">View post<span aria-hidden="true"> ↗<\/span><\/a>/);
});

test('native LinkedIn card escapes hostile account, text and url, and cannot add elements', () => {
  const html = postCard(li({ account: 'in/<img src=x onerror=alert(1)>', text: '<script>alert(2)</script> "hi" & bye', url: 'https://www.linkedin.com/posts/a?x=1&y=2' }));
  assert.ok(!/<img src=x|<script/.test(html));
  assert.ok(html.includes('&lt;script&gt;alert(2)&lt;/script&gt; &quot;hi&quot; &amp; bye'));
  assert.ok(html.includes('href="https://www.linkedin.com/posts/a?x=1&amp;y=2"'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('native X card: display name, @handle and date, icon counts with sr-only labels, and View post', () => {
  const html = postCard({ id: 'P2', platform: 'x', account: 'ExaAILabs', owner: 'company', url: 'https://x.com/ExaAILabs/status/1', published: '2026-10-19', text: 'Exa 3.0 is out.', metrics: { likes: 2118, reposts: 156, replies: 91 } }, Y);
  assert.match(html, /^<article class="xpost nat xx">/);
  assert.match(html, /<span class="av" aria-hidden="true">E<\/span>/);
  assert.match(html, /<b>ExaAILabs<\/b><span class="sub">@ExaAILabs · 19 Oct<\/span>/, 'name, then @handle and date');
  assert.match(html, /<b>2,118<\/b><span class="sr-only"> likes<\/span>/);
  assert.match(html, /<b>156<\/b><span class="sr-only"> reposts<\/span>/);
  assert.match(html, /<b>91<\/b><span class="sr-only"> replies<\/span>/);
  assert.ok(!html.includes('class="acts"'), 'the Like/Comment row is LinkedIn only');
  assert.match(html, /aria-label="Open this X post">View post/);
  assert.ok(!html.includes('@@'));
  assert.match(postCard({ id: 'P3', platform: 'x', account: '@Already', owner: 'company', url: 'https://x.com/a/1', published: '2026-10-19', text: 't', metrics: { likes: 1 } }, Y), /<b>Already<\/b><span class="sub">@Already · /, 'a handle that already has @ is not doubled');
});

test('native cards with no readable numbers say "Engagement not visible" and never draw a 0; other platforms keep the generic card', () => {
  for (const platform of ['linkedin', 'x']) {
    for (const metrics of [{}, undefined, { likes: null, reactions: null }]) {
      const html = postCard({ id: 'P1', platform, account: 'a', owner: 'company', url: 'https://x.test/1', published: '2026-10-13', text: 't', metrics });
      assert.match(html, /<span class="muted">Engagement not visible<\/span>/, `${platform}`);
      assert.ok(!/<b>0<\/b>|<svg class="mi"|sr-only/.test(html), `${platform}: no zero, no icons, no empty labels`);
    }
  }
  const generic = postCard({ id: 'P4', platform: 'reddit', account: 'r_thing', owner: 'community', url: 'https://reddit.com/r/x/1', published: '2026-10-13', text: 'Thread', metrics: { points: 12, comments: 3 } });
  assert.match(generic, /^<article class="xpost">/);
  assert.ok(!/xpost nat|class="av"|class="acts"/.test(generic));
  assert.match(generic, /<span><b>12<\/b> points<\/span>/);
});

test('posts with no numbers do not drag an account baseline down to zero', () => {
  const mk = (i, metrics) => ({ id: `P${i}`, platform: 'linkedin', account: 'a', owner: 'company', url: `https://x.test/${i}`, published: `2026-10-0${i}`, text: 't', metrics });
  const posts = [mk(1, { reactions: 100 }), mk(2, { reactions: 120 }), mk(3, { reactions: 90 }), mk(4, { reactions: 110 }), mk(5, { reactions: 105 }), mk(6, {}), mk(7, {}), mk(8, {})];
  const [s] = accountStats(posts, { asOf: '2026-10-20' });
  assert.equal(s.sampled, 8);
  assert.equal(s.measured, 5);
  assert.equal(s.median_engagement, 105);
  assert.ok(s.baseline_ok);
});

// ---------- exhibits next to claims ----------

test('a claim shows the post, ad or page it rests on, and never the same one twice', () => {
  const { evidence, analysis } = load();
  const { html } = render(evidence, analysis);
  const urls = [...html.matchAll(/<article class="xpost[^"]*">[\s\S]*?<a class="ext" href="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(urls).size, urls.length);
  const frames = [...html.matchAll(/<a class="frame" href="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(frames).size, frames.length);
});

// ---------- merge assigns ids to posts and screenshots ----------

test('merge gives posts and screenshots stable ids and resolves their evidence refs', () => {
  const run = { domain: 'x.test', captured_at: '2026-10-20T00:00:00Z' };
  const item = (ref, channel) => ({ ref, channel, status: 'observed', finding: 'f', url: 'https://x.test/' });
  const { evidence } = merge(run, [
    { layer: 'owned', items: [item('o1', 'seo_content')], screens: [{ kind: 'home', page_url: 'https://x.test/', image: 'assets/h.jpg', caption: 'c', evidence_ref: 'o1' }] },
    { layer: 'social', items: [item('s1', 'social')], posts: [{ platform: 'x', account: 'a', url: 'https://x.com/a/1', published: '2026-10-01', text: 't', evidence_ref: 's1' }] },
  ]);
  assert.equal(evidence.screens[0].id, 'S01');
  assert.equal(evidence.screens[0].evidence_id, 'E001');
  assert.equal(evidence.posts[0].id, 'P001');
  assert.equal(evidence.posts[0].evidence_id, 'E002');
  assert.throws(() => merge(run, [{ layer: 'owned', items: [item('o1', 'seo_content')], screens: [{ kind: 'home', page_url: 'https://x.test/', image: 'a.jpg', evidence_ref: 'nope' }] }]), /does not match any item ref/);
});

test('the best company post is drawn once, in the strip; the strip keeps only the best posts', () => {
  const { evidence, analysis } = load();
  const best = evidence.posts.filter((p) => p.owner === 'company' && hasMetrics(p)).sort((a, b) => engagementOf(b) - engagementOf(a))[0];
  const { html } = render(evidence, analysis);
  const urls = [...html.matchAll(/<article class="xpost[^"]*">[\s\S]*?<a class="ext" href="([^"]+)"/g)].map((m) => m[1]);
  const mine = best.url.replace(/&/g, '&amp;');
  assert.equal(urls.filter((u) => u === mine).length, 1, 'the best post is one card, in the strip');
  assert.equal(new Set(urls).size, urls.length, 'no post card twice');
  assert.ok(stripOf(paneOf(html, 'organic_social')).includes(mine), 'and it is in the company-social strip');
});

// ---------- navigation and page structure ----------


test('the rail: every nav href is an id on the page, entries follow the page order, and the skip link lands on the report', () => {
  const { evidence, analysis } = load();
  const { html } = renderReport(evidence, analysis, { baseDir: FIX, scores: SCORES });
  const rail = html.split('<nav class="rail"')[1].split('</nav>')[0];
  assert.match(rail, /^ aria-label="Sections"><ol>(<li><a href="#[^"]+"><span>[^<]+<\/span>(<b class="rs s-[gn]"><span class="sr-only">top score <\/span>\d+<\/b>)?<\/a><\/li>)+<\/ol>$/, 'a plain list of links');
  const hrefs = [...rail.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  assert.ok(hrefs.length >= 5);
  for (const h of hrefs) assert.ok(html.includes(` id="${h}"`), `rail links to missing #${h}`);
  const at = hrefs.map((h) => html.indexOf(` id="${h}"`));
  assert.deepEqual(at, [...at].sort((a, b) => a - b), 'rail order is page order');
  assert.equal(hrefs[0], 'summary');
  assert.equal(hrefs.at(-1), 'gaps');
  assert.equal(hrefs.at(-2), 'tech');
  // Sections present appear in SECTIONS order, none out of order or missing.
  const secs = hrefs.filter((h) => h.startsWith('s-')).map((h) => h.slice(2));
  assert.deepEqual(secs, SECTIONS.map((x) => x.id), 'one entry per section, in SECTIONS order');
  assert.deepEqual([...html.matchAll(/<section id="s-([\w-]+)"/g)].map((m) => m[1]), secs, 'and the sections are in the same order on the page');
  assert.match(html, /<a class="skip" href="#report">/);
  assert.match(html, /<main id="report">/);
  assert.match(html, /\.rail\{position:sticky;top:0/);
  // A section with nothing to show has no rail entry: no scores, no activity entries at all.
  const bare = renderReport(evidence, analysis, { baseDir: FIX, scores: null }).html;
  const bareRail = bare.split('<nav class="rail"')[1].split('</nav>')[0];
  assert.ok(!/href="#s-/.test(bareRail));
});

const railEntries = (html) => [...html.split('<nav class="rail"')[1].split('</nav>')[0].matchAll(/<li><a href="#([^"]+)"><span>([^<]+)<\/span>(?:<b class="rs (s-[gn])"><span class="sr-only">top score <\/span>(\d+)<\/b>)?<\/a><\/li>/g)]
  .map((m) => ({ id: m[1], label: m[2], cls: m[3] ?? null, num: m[4] === undefined ? null : Number(m[4]) }));

test('the rail: a section number is its top scored activity, green only from 70; unscored sections and fixed entries have none', () => {
  const { evidence, analysis } = load();
  const entries = railEntries(renderReport(evidence, analysis, { baseDir: FIX, scores: SCORES }).html);
  const by = Object.fromEntries(entries.map((e) => [e.id, e]));
  assert.equal(by['s-paid-search'].num, 70);
  assert.equal(by['s-paid-search'].cls, 's-g', '70 is strong');
  assert.equal(by['s-seo'].num, 40);
  assert.equal(by['s-seo'].cls, 's-n', 'below 70 is not green');
  for (const e of entries) if (e.num === null) assert.equal(e.cls, null);
  for (const id of ['summary', 'take', 'traffic', 'tech', 'gaps', 's-organic', 's-owned', 's-earned']) if (by[id]) assert.equal(by[id].num, null, `${id} has no number`);
  assert.ok(!entries.some((e) => e.num !== null && !['s-paid-search', 's-seo'].includes(e.id)), 'only sections with a scored activity are numbered');
  // The number is the max over the section's scored activities, with the 70 cut-off exact on both sides.
  const act = (score) => ({ score, confidence: 0.9, basis: 'jev', evidence_ids: ['E001'] });
  const seoRail = (activities) => railEntries(renderReport(evidence, analysis, { baseDir: FIX, scores: { activities } }).html).find((x) => x.id === 's-seo');
  const hi = seoRail({ aeo: act(55), seo_content: act(82) });
  assert.deepEqual([hi.num, hi.cls], [82, 's-g'], 'the max of two scored activities');
  const lo = seoRail({ aeo: act(69), seo_content: act(31) });
  assert.deepEqual([lo.num, lo.cls], [69, 's-n'], '69 is not strong');
  const edge = seoRail({ aeo: act(70) });
  assert.deepEqual([edge.num, edge.cls], [70, 's-g'], '70 is strong');
});

const SCORES = { activities: { google_ads: { score: 70, confidence: 0.9, basis: 'jev', evidence_ids: ['E001'] }, seo_content: { score: 40, confidence: 0.9, basis: 'jev', evidence_ids: ['E011'] } } };

test('activity blocks have no folds: no details element, no "Findings and sources", nothing starts open', () => {
  const { evidence, analysis } = load();
  const html = render(evidence, analysis).html;
  const main = html.split('<main')[1];
  assert.ok(!main.includes('fold2'), 'no fold2 anywhere in the content');
  assert.ok(!/Findings and sources/.test(html), 'the findings fold is gone');
  assert.ok(!main.includes('<details') && !main.includes('<summary'), 'nothing in the report folds');
  for (const id of ['organic_social', 'google_ads', 'pricing', 'aeo', 'seo_content', 'open_source']) assert.ok(!paneOf(html, id).includes('<details'), `${id}: no details element`);
  assert.ok(!/<summary>/.test(sectionOf(html, 'gaps')), 'the gaps card has no folds');
});
test('page order: hero, takeaways, traffic, the sections in SECTIONS order, tech stack, gaps, footer', () => {
  const { evidence, analysis } = load();
  analysis.takeaways = [{ activity: 'google_ads', move: 'Test more angles.', observed: 'Many ads run for months.', evidence_ids: [evidence.items[0].id] }];
  evidence.traffic = { evidence_id: evidence.items[0].id, label: 'Monthly visits', points: [{ month: '2026-07', value: 1000 }, { month: '2026-08', value: 1500 }] };
  const html = renderReport(evidence, analysis, { baseDir: FIX, scores: allScores(evidence) }).html;
  const at = (needle) => { const i = html.indexOf(needle); assert.ok(i >= 0, `missing ${needle}`); return i; };
  const order = ['id="summary"', 'id="take"', 'id="traffic"', ...SECTIONS.map((x) => `id="s-${x.id}"`), 'id="tech"', 'id="gaps"', '<footer class="about'].map(at);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test('palette: light gray page, white panels, green only for scores of 70 and up, no amber, only declared tokens carry colour, no dark mode, no external scripts', () => {
  const { evidence, analysis } = load();
  const html = render(evidence, analysis).html;
  const css = html.split('</style>')[0];
  const root = css.match(/:root\{([\s\S]*?)\n\}/)[1];
  const tok = (n) => root.match(new RegExp(`--${n}:\\s*([^;\\n]+)`))[1].trim();
  assert.equal(tok('bg'), '#f4f4f4', 'light gray page');
  assert.equal(tok('panel'), '#ffffff', 'white panels');
  assert.equal(tok('hi'), '#15803d', 'green marks a strong score');
  assert.equal(tok('mid'), '#4b4b4b', 'a steady score is gray, not amber');
  assert.ok(!/#a16207|amber/i.test(css), 'no amber anywhere');
  // Outside the :root token block, colour is gray unless it is one of the declared semantic colours.
  const rest = css.replace(root, '');
  // #0a66c2 LinkedIn, #e1002d YouTube and #c13584 Instagram are the platforms' own brand colours on the channel-card marks (.cm-*).
  const allowedHex = new Set(['#fff', '#ffffff', '#000', '#000000', '#111', '#fff3b0', '#0a66c2', '#e1002d', '#c13584']);
  for (const m of rest.matchAll(/#([0-9a-f]{3}|[0-9a-f]{6})\b/gi)) {
    const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
    const [r, g, b] = [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16));
    const neutral = Math.max(r, g, b) - Math.min(r, g, b) <= 12;
    assert.ok(neutral || allowedHex.has(`#${m[1].toLowerCase()}`), `undeclared colour #${m[1]} outside the tokens`);
  }
  assert.ok(!/(?<![a-z-])hsla?\(/i.test(rest), 'no hsl colours outside the tokens');
  assert.ok(!/prefers-color-scheme\s*:\s*dark|\[data-theme/.test(css), 'no dark mode');
  assert.match(html, /<meta name="color-scheme" content="light">/);
  assert.ok(!/--h:/.test(css), 'no hue variables');
  // No external script sources: the only script is the one inline block, allowed by its hash.
  assert.ok(!/<script[^>]*\bsrc=/i.test(html), 'no external scripts');
  const csp = html.match(/Content-Security-Policy" content="([^"]*)"/)[1];
  const scriptSrc = csp.match(/script-src ([^;]*)/)[1];
  assert.match(scriptSrc, /^'sha256-[A-Za-z0-9+/=]+'$/, 'script-src is a single hash');
  assert.ok(!/unsafe-eval|unsafe-inline/.test(scriptSrc));
  assert.match(csp, /style-src 'unsafe-inline' https:\/\/fonts\.googleapis\.com/);
  assert.match(csp, /font-src https:\/\/fonts\.gstatic\.com/);
  const body = html.split('<main')[1];
  assert.ok(!/style="[^"]*(color|background)[^"]*"/i.test(body), 'no inline colours in the content');
  assert.ok(!/\son[a-z]+="/i.test(body), 'no inline event handlers');
});

test('a section with nothing scored is not painted as an alarm: every block says Not covered, no number', () => {
  const { evidence, analysis } = load();
  const scores = allScores(evidence, { google_ads: null, paid_social: null });
  const html = renderReport(evidence, analysis, { baseDir: FIX, scores }).html;
  for (const sec of ['paid-social', 'paid-search']) {
    const s = sectionOf(html, `s-${sec}`);
    assert.equal((s.match(/<span class="ascore word">Not covered<\/span>/g) ?? []).length, 1, sec);
    assert.ok(!/class="ascore s-/.test(s), 'no number');
  }
  assert.ok(!/class="[^"]*\balarm\b/.test(html));
});
test('headings carry no footnote marks; sections are named', () => {
  const { evidence, analysis } = load();
  const html = renderReport(evidence, analysis, { baseDir: FIX, scores: SCORES }).html;
  const body = html.split('<main')[1];
  assert.ok(!/<h[23][^>]*>[^<]*<sup/.test(body), 'footnote marks stay out of headings');
  for (const m of body.matchAll(/<section id="([^"]+)"[^>]*aria-labelledby="([^"]+)"/g)) assert.ok(body.includes(`id="${m[2]}"`), `${m[1]} points at a missing heading`);
  assert.ok((body.match(/aria-labelledby=/g) ?? []).length >= 3, 'the main sections are named');
});

test('closing section is a plain card of what we could not see: not scored, not covered, the analyst\'s list; no folds', () => {
  const { evidence, analysis } = load();
  const html = renderReport(evidence, analysis, { baseDir: FIX, scores: allScores(evidence, { video: null }) }).html;
  const gaps = sectionOf(html, 'gaps');
  assert.match(gaps, /<section id="gaps" class="block card" aria-labelledby="gaps-h">/);
  assert.match(gaps, /<h2 id="gaps-h">What we could not see<\/h2>/);
  assert.match(gaps, /<p class="gapline"><b>Not scored:<\/b>[^<]*Video/);
  assert.match(gaps, /<p class="gapline"><b>Not covered:<\/b>/);
  for (const c of analysis.couldnt_see) assert.ok(gaps.includes(c.text.replace(/&/g, '&amp;')), 'the analyst\'s list is shown');
  assert.ok(!/<details|<summary|How to see more|Checked and not found/.test(gaps));
  assert.ok(html.indexOf('id="gaps"') > html.indexOf('id="tech"'), 'it closes the report, after the tech stack and before the footer');
  assert.ok(html.indexOf('id="gaps"') < html.indexOf('<footer class="about'));
});

// ---------- screenshots ----------

test('screenshots enlarge in a dialog and carry a link to the live page', () => {
  const { evidence, analysis } = load();
  const html = render(evidence, analysis).html;
  assert.match(html, /<dialog id="zoom"/);
  assert.match(html, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.match(html, /\[data-zoom\]/);
  assert.match(html, /<figure class="xshot k-/);
  assert.match(html, /Open page<span aria-hidden="true"> ↗<\/span>/);
});

// ---------- accessibility and print ----------

test('print hides the rail and the source panels; footnote targets are big enough', () => {
  const { evidence, analysis } = load();
  const html = render(evidence, analysis).html;
  const print = html.split('@media print{')[1].split('\n}')[0];
  assert.match(print, /\.rail,\.skip,\.zclose\{display:none!important\}/);
  assert.match(print, /\.srcs\{display:none\}/);
  assert.match(html, /\.fn,\.fnlink\{[^}]*min-width:1\.5rem;min-height:1\.5rem/);
});

test('post cards carry a platform mark: decorative on generic cards, a labelled mark on native LinkedIn and X cards', () => {
  const generic = postCard({ id: 'P1', platform: 'hn', account: 'jane', owner: 'company', url: 'https://x.test/1', published: '2026-10-13', text: 'Hi', metrics: { points: 5 } });
  assert.match(generic, /<span class="pmark pm-hn" aria-hidden="true">Y<\/span>/);
  const li = postCard({ id: 'P2', platform: 'linkedin', account: 'in/jane', owner: 'founder', url: 'https://x.test/2', published: '2026-10-13', text: 'Hi', metrics: { reactions: 5 } });
  assert.match(li, /<span class="plat plat-li" aria-label="LinkedIn">in<\/span>/);
  const x = postCard({ id: 'P3', platform: 'x', account: 'jane', owner: 'company', url: 'https://x.test/3', published: '2026-10-13', text: 'Hi', metrics: { likes: 5 } });
  assert.match(x, /<span class="plat plat-x" aria-label="X">X<\/span>/);
});

test('short captions: the page title, else the first clause; never the label again, never cut inside a name', async () => {
  const { shortCaption } = await import('../scripts/exhibits.mjs');
  assert.equal(shortCaption({ kind: 'comparison', caption: 'Comparison page "Recall.ai vs Nylas Notetaker": "Most tools only join calls as bots."' }), '"Recall.ai vs Nylas Notetaker"');
  assert.equal(shortCaption({ kind: 'home', caption: 'Homepage headline: "The API to get transcripts". Two buttons.' }), '"The API to get transcripts"');
  assert.equal(shortCaption({ kind: 'signup', caption: 'Signup page.' }), '');
  assert.equal(shortCaption({ kind: 'customers', title: 'Recall.ai x BrightHire Case Study', caption: 'long text' }), 'Recall.ai x BrightHire Case Study');
});

// ---------- cadence and merge ----------

test('updatesByMonth counts each page once in the month of its last update, over the last twelve months only', () => {
  const m = updatesByMonth([
    { loc: 'a', lastmod: '2026-10-05' }, { loc: 'a', lastmod: '2026-10-05' }, { loc: 'b', lastmod: '2026-09-30T10:00:00Z' },
    { loc: 'c', lastmod: '2024-01-01' }, { loc: 'd' },
  ], { asOf: '2026-10-20', months: 12 });
  assert.equal(m.length, 12);
  assert.equal(m.at(-1).month, '2026-10');
  assert.equal(m.at(-1).pages, 1, 'a repeated url is one page');
  assert.equal(m.at(-2).pages, 1);
  assert.equal(m.reduce((n, x) => n + x.pages, 0), 2, 'old and undated pages are not counted');
  assert.deepEqual(updatesByMonth([], { asOf: 'nonsense' }), []);
});

test('merge rejects the retired roles and journey fragment keys', () => {
  const run = { domain: 'x.test', captured_at: '2026-10-20T00:00:00Z' };
  const item = (ref, channel) => ({ ref, channel, status: 'observed', finding: 'f', url: 'https://x.test/' });
  assert.throws(() => merge(run, [{ layer: 'owned', items: [item('o1', 'seo_content')], journey: [{ step: 'Visit', evidence_ref: 'o1' }] }]), /unknown key "journey"/);
  assert.throws(() => merge(run, [{ layer: 'company', items: [item('c1', 'hiring')], roles: { items: [], evidence_ref: 'c1' } }]), /unknown key "roles"/);
});

test('screenshots and ad creatives are shown in colour, never filtered gray', () => {
  const { evidence, analysis } = load();
  const html = render(evidence, analysis).html;
  const css = html.split('</style>')[0];
  assert.ok(!/grayscale\(/.test(css), 'no grayscale filter anywhere');
  assert.ok(!/\.(frame|thumb|zoom) img\{[^}]*filter:/.test(css), 'images carry no filter');
});
