import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderReport } from '../scripts/render.mjs';
import { merge } from '../scripts/merge.mjs';
import { STRIP_MAX } from '../scripts/proof.mjs';
import { engagementOf } from '../scripts/social.mjs';
import { renderChannelCards, personName } from '../scripts/proof.mjs';
import { paneOf, stripOf, stripItems, sectionOf, kfRows, chanCards } from './helpers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, 'fixtures', 'exa.ai');
const MUD = JSON.parse(readFileSync(join(HERE, 'fixtures', 'meta-ads-mudwtr.json'), 'utf8')).meta_ads;
const clone = (x) => JSON.parse(JSON.stringify(x));
const load = () => ({
  evidence: JSON.parse(readFileSync(join(FIX, 'evidence.json'), 'utf8')),
  analysis: JSON.parse(readFileSync(join(FIX, 'analysis.json'), 'utf8')),
});
const render = (ev, an) => renderReport(ev, an, { baseDir: FIX });
const metaEv = (ev) => ev.items.find((i) => i.channel === 'meta_ads');
// The fixture's evidence with Upspring's meta_ads attached, captured 2026-10-20 so day counts are exact.
function withMeta(mod) {
  const { evidence, analysis } = load();
  evidence.captured_at = '2026-10-20T00:00:00Z';
  const m = clone(MUD);
  evidence.meta_ads = { ...m, evidence_id: metaEv(evidence).id };
  if (mod) mod(evidence.meta_ads, evidence);
  return { evidence, analysis };
}
const paid = (ev, an) => paneOf(render(ev, an).html, 'paid_social');

// ---------- Meta ads strip ----------

test('meta ads: a Paid social strip of cards with library link, https thumbnail, alt, running days, strength and quoted hook', () => {
  const { evidence, analysis } = withMeta();
  const pane = paid(evidence, analysis);
  const strip = stripOf(pane);
  assert.match(strip, /Their best-performing Meta ads/);
  const cards = stripItems(strip);
  assert.equal(cards.length, MUD.ads.length);
  cards.forEach((c, i) => {
    const a = MUD.ads[i];
    assert.equal((c.match(/<figure class="xad">/g) ?? []).length, 1);
    assert.ok(c.includes(`href="${a.url}"`) && /target="_blank" rel="noopener noreferrer"/.test(c), 'external Ad Library link');
    assert.match(c, new RegExp(`<img alt="video ad preview: [^"]+" referrerpolicy="no-referrer" loading="lazy" src="${a.thumbnail_url.replace(/[.]/g, '\\.')}">`));
    assert.match(c, /src="https:\/\//);
    assert.match(c, /delivery strength 5\/5/);
    assert.ok(c.includes(`“${a.hook_text.replace(/'/g, '&#39;')}”`), `hook in quotes: ${a.hook_text}`);
  });
  // Captured 2026-10-20; started 2026-10-09 and 2026-10-02.
  assert.match(cards[0], /<b>Running 11 days<\/b> · since 9 Oct/);
  assert.match(cards[1], /<b>Running 18 days<\/b>/);
});

test('meta ads: running days are computed from the capture date, singular for one day, never negative', () => {
  const { evidence, analysis } = withMeta((m) => {
    m.ads[0].started_at = '2026-10-19';
    m.ads[1].started_at = '2026-10-25'; // after the capture date
  });
  const cards = stripItems(stripOf(paid(evidence, analysis)));
  assert.match(cards[0], /Running 1 day<\/b>/);
  assert.match(cards[1], /Running 0 days<\/b>/);
});

test('meta ads: no more than STRIP_MAX cards', () => {
  const { evidence, analysis } = withMeta((m) => {
    m.ads = Array.from({ length: STRIP_MAX + 5 }, (_, i) => ({ ...MUD.ads[0], id: `ad${i}`, url: `https://www.facebook.com/ads/library/?id=${i}` }));
  });
  assert.equal(stripItems(stripOf(paid(evidence, analysis))).length, STRIP_MAX);
});

test('meta ads: labelled rows give active count, format, funnel stage, spend grade as an estimate, and still link the ad libraries', () => {
  const { evidence, analysis } = withMeta();
  const pane = paid(evidence, analysis);
  const rows = kfRows(pane);
  assert.deepEqual([...rows.keys()], ['Active Meta ads', 'Format', 'Funnel stage', 'Spend', 'Ad libraries']);
  assert.match(rows.get('Active Meta ads'), /<b>226<\/b>/);
  assert.match(rows.get('Format'), /87% video/);
  assert.match(rows.get('Funnel stage'), /57% consideration/);
  assert.match(rows.get('Spend'), /Grade A/);
  assert.match(rows.get('Spend'), /≥ \$400K\/mo/);
  assert.match(rows.get('Spend'), /Upspring estimate/, 'the spend is labelled as an estimate and names its source');
  assert.match(rows.get('Ad libraries'), /href="https:\/\/[^"]*facebook\.com\/ads\/library[^"]*"/);
  assert.ok(!/<p class="facts">/.test(pane), 'the facts are rows now, not a prose line');
});

test('meta ads: an ad without thumbnail_url is a text card with the hook, not a broken img; a non-https thumbnail is never an img src', () => {
  const { evidence, analysis } = withMeta((m) => {
    delete m.ads[0].thumbnail_url;
    m.ads[1].thumbnail_url = 'http://insecure.example/t.webp';
    m.ads[2].thumbnail_url = 'javascript:alert(1)';
  });
  const cards = stripItems(stripOf(paid(evidence, analysis)));
  for (const i of [0, 1, 2]) {
    assert.ok(!cards[i].includes('<img'), `card ${i} has no img`);
    assert.match(cards[i], /<a class="thumb textad" href="https:\/\/www\.facebook\.com\/ads\/library/);
  }
  assert.ok(cards[0].includes('FREE bag of Pumpkin Spice Latte!?'));
  assert.ok(!stripOf(paid(evidence, analysis)).includes('insecure.example'));
  assert.ok(cards[3].includes('<img'), 'the untouched ad keeps its image');
});

test('meta ads: hostile hook_text, one_line, advertiser name and thumbnail are escaped', () => {
  const XSS = '<script>alert(1)</script><img src=x onerror=alert(2)>';
  const { evidence, analysis } = withMeta((m) => {
    m.advertiser.name = XSS;
    m.source = XSS;
    m.spend.grade = XSS;
    m.ads[0].hook_text = XSS;
    m.ads[0].one_line = XSS;
    m.ads[1].thumbnail_url = 'https://x.test/t.webp"onerror="alert(3)';
    m.ads[1].hook_text = '';
    m.ads[1].one_line = XSS;
  });
  const { html } = render(evidence, analysis);
  assert.ok(!html.includes('<script>alert(1)'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!/"onerror="alert\(3\)/.test(html));
  assert.equal((html.match(/<script/g) ?? []).length, 1, 'only the report\'s own script');
  assert.ok(html.includes('&lt;script&gt;alert(1)'));
});

// ---------- validation ----------

test('meta ads: bad data is a build error (missing or unknown evidence id, ads not a list, bad ad url or id)', () => {
  const bad = (mod, re) => {
    const { evidence, analysis } = withMeta(mod);
    assert.throws(() => render(evidence, analysis), re);
  };
  bad((m) => { delete m.evidence_id; }, /meta_ads: "evidence_id" must name an existing evidence item/);
  bad((m) => { m.evidence_id = 'E999'; }, /meta_ads: "evidence_id" must name an existing evidence item/);
  bad((m) => { m.ads = 'many'; }, /meta_ads: "ads" must be an array/);
  bad((m) => { m.ads = { 0: {} }; }, /meta_ads: "ads" must be an array/);
  bad((m) => { m.ads[0].url = 'javascript:alert(1)'; }, /meta_ads: ad \S+ needs an id and an http\(s\) "url"/);
  bad((m) => { delete m.ads[0].url; }, /meta_ads: ad \S+ needs an id and an http\(s\) "url"/);
  bad((m) => { m.ads[0].url = 'ftp://x.test/a'; }, /needs an id and an http\(s\) "url"/);
  bad((m) => { delete m.ads[0].id; }, /meta_ads: ad undefined needs an id/);
});

test('without meta_ads the paid_social block still shows the ad-library links line and no strip', () => {
  const { evidence, analysis } = load();
  assert.ok(!evidence.meta_ads);
  const pane = paid(evidence, analysis);
  const rows = kfRows(pane);
  assert.deepEqual([...rows.keys()], ['Ad libraries'], 'no Meta numbers without Meta data');
  assert.match(rows.get('Ad libraries'), /<a class="lpill" href="https:\/\/[^"]+" target="_blank" rel="noopener noreferrer">Meta<\/a>/);
  assert.equal(stripOf(pane), '');
  assert.ok(!pane.includes('Upspring') && !pane.includes('Active Meta ads'));
});

// ---------- merge ----------

test('merge: meta_ads is a single block and its evidence_ref resolves to evidence_id like traffic', () => {
  const run = { domain: 'mudwtr.com', captured_at: '2026-10-21T00:00:00Z' };
  const item = { ref: 'm1', channel: 'meta_ads', status: 'observed', finding: '226 active Meta ads (Upspring).', url: 'https://www.facebook.com/ads/library/?id=172538983355501' };
  const { evidence } = merge(run, [{ layer: 'company', items: [item], meta_ads: { ...clone(MUD), evidence_ref: 'm1' } }]);
  assert.equal(evidence.meta_ads.evidence_id, 'E001');
  assert.ok(!('evidence_ref' in evidence.meta_ads));
  assert.equal(evidence.meta_ads.ads.length, MUD.ads.length);
  assert.equal(evidence.meta_ads.active_ads, 226);
  assert.throws(() => merge(run, [{ layer: 'company', items: [item], meta_ads: { ...clone(MUD), evidence_ref: 'nope' } }]), /meta_ads: evidence_ref "nope" does not match any item ref/);
});

// ---------- Instagram and TikTok ----------

const post = (id, platform, over = {}) => ({
  id, platform, account: 'exa', owner: 'company', url: `https://www.${platform}.com/p/${id}`,
  published: '2026-10-18', text: `A ${platform} post ${id}`, evidence_id: 'E015', ...over,
});
function withPosts(posts, accounts) {
  const { evidence, analysis } = load();
  evidence.posts = posts;
  if (accounts) evidence.accounts = accounts;
  return { evidence, analysis };
}
const social = (ev, an, id = 'organic_social') => paneOf(render(ev, an).html, id);

test('engagementOf: instagram is likes+comments, tiktok is likes+comments+shares (views excluded)', () => {
  assert.equal(engagementOf({ platform: 'instagram', metrics: { likes: 10, comments: 3, views: 9999, shares: 50 } }), 13);
  assert.equal(engagementOf({ platform: 'tiktok', metrics: { likes: 10, comments: 3, shares: 5, views: 9999 } }), 18);
  assert.equal(engagementOf({ platform: 'instagram', metrics: {} }), 0);
  assert.equal(engagementOf({ platform: 'tiktok' }), 0);
});

test('instagram and tiktok posts render generic cards with the right metric labels in order', () => {
  const { evidence, analysis } = withPosts([
    post('ig1', 'instagram', { metrics: { likes: 1200, comments: 34, views: 56000 } }),
    post('tt1', 'tiktok', { metrics: { views: 98000, likes: 4100, comments: 77, shares: 310 } }),
  ]);
  const cards = stripItems(stripOf(social(evidence, analysis)));
  const ig = cards.find((c) => c.includes('instagram post ig1'));
  const tt = cards.find((c) => c.includes('tiktok post tt1'));
  assert.ok(ig && tt);
  assert.match(ig, /<article class="xpost">/);
  assert.match(ig, /pmark pm-instagram/);
  assert.match(ig, /Instagram · /);
  assert.match(ig, /<div class="xnums"><span><b>1,200<\/b> likes<\/span><span><b>34<\/b> comments<\/span><span><b>56,000<\/b> views<\/span><\/div>/);
  assert.match(tt, /TikTok · /);
  assert.match(tt, /<div class="xnums"><span><b>98,000<\/b> views<\/span><span><b>4,100<\/b> likes<\/span><span><b>77<\/b> comments<\/span><span><b>310<\/b> shares<\/span><\/div>/);
});

test('instagram/tiktok: an https thumbnail makes a withthumb card linking to the post; an http one is ignored; no metrics says engagement not visible', () => {
  const { evidence, analysis } = withPosts([
    post('ig1', 'instagram', { metrics: { likes: 5 }, thumbnail_url: 'https://cdn.example/t1.jpg' }),
    post('tt1', 'tiktok', { metrics: { likes: 4 }, thumbnail_url: 'http://cdn.example/t2.jpg' }),
  ]);
  const cards = stripItems(stripOf(social(evidence, analysis)));
  const by = (id) => cards.find((c) => c.includes(`post ${id}`));
  const ig = by('ig1');
  assert.match(ig, /<article class="xpost withthumb">/);
  assert.match(ig, /<a class="pthumb" href="https:\/\/www\.instagram\.com\/p\/ig1"[^>]*><img alt="Instagram post preview" referrerpolicy="no-referrer" loading="lazy" src="https:\/\/cdn\.example\/t1\.jpg"><\/a>/);
  assert.ok(!by('tt1').includes('<img') && !by('tt1').includes('withthumb') && !by('tt1').includes('cdn.example/t2'), 'http thumbnail ignored');
  // With no readable metrics (shown only when nothing is measured) the card says so instead of showing zeros.
  const none = withPosts([post('ig2', 'instagram', { thumbnail_url: 'javascript:alert(1)' }), post('tt2', 'tiktok', { metrics: {} })]);
  const nc = stripItems(stripOf(social(none.evidence, none.analysis)));
  assert.equal(nc.length, 2);
  for (const c of nc) {
    assert.match(c, /<span class="muted">Engagement not visible<\/span>/);
    assert.ok(!c.includes('<img') && !c.includes('<b>0</b>'));
  }
});

test('instagram/tiktok: higher engagement posts come first, and unmeasured ones do not show zeros', () => {
  const { evidence, analysis } = withPosts([
    post('ig1', 'instagram', { metrics: { likes: 10, comments: 1 } }),
    post('tt1', 'tiktok', { metrics: { likes: 10, comments: 1, shares: 100 } }),
    post('ig2', 'instagram', {}),
  ]);
  const cards = stripItems(stripOf(social(evidence, analysis)));
  assert.deepEqual(cards.map((c) => c.match(/post (ig1|tt1|ig2)/)[1]), ['tt1', 'ig1']);
});

// ---------- channel cards ----------

const organic = (ev, an) => sectionOf(render(ev, an).html, 's-organic');
const acct = (platform, handle, owner, followers, over = {}) => ({ platform, handle, url: `https://${platform}.example/${handle}`, owner, followers, evidence_id: 'E015', ...over });

test('personName: a linkedin slug reads as a name', () => {
  assert.equal(personName('michael-whittle-43735a2b'), 'Michael Whittle', 'trailing hex id dropped');
  assert.equal(personName('michael-whittle-43735A2B'), 'Michael Whittle', 'uppercase hex id dropped');
  assert.equal(personName('zhu-amanda'), 'Zhu Amanda', 'no id: kept');
  assert.equal(personName('timturner'), 'timturner', 'single word left as written');
  assert.equal(personName('subsplash'), 'subsplash');
  assert.equal(personName('michael-whittle-43735a2b/'), 'Michael Whittle', 'trailing slash');
  assert.equal(personName('ana-lopez'), 'Ana Lopez', 'a real word last part is not an id');
  assert.equal(personName('john-smith-12345678'), 'John Smith', 'an all-digit id is dropped');
});

test('channel cards: one card per account with a safe url, company before founder, compact follower numbers, linked', () => {
  const { evidence, analysis } = withPosts([], [
    acct('linkedin', 'in/jane-doe', 'founder', 12500000, { url: 'https://www.linkedin.com/in/jane-doe' }),
    acct('tiktok', 'exa', 'company', 1087, { url: 'https://www.tiktok.com/@exa' }),
    acct('instagram', 'exa', 'company', 385904, { url: 'https://www.instagram.com/exa/' }),
    acct('x', 'staffer', 'employee', 800, { url: 'https://x.com/staffer' }),
  ]);
  const sec = organic(evidence, analysis);
  const cards = chanCards(sec);
  assert.deepEqual(cards.map((c) => `${c.name} ${c.owner}`), ['Instagram Company', 'TikTok Company', 'LinkedIn Founder', 'X Team'],
    'company first (more followers first), then founder, then team');
  assert.deepEqual(cards.map((c) => c.href), ['https://www.instagram.com/exa/', 'https://www.tiktok.com/@exa', 'https://www.linkedin.com/in/jane-doe', 'https://x.com/staffer']);
  assert.match(cards[0].followers, /<b>386k<\/b> followers/);
  assert.match(cards[1].followers, /<b>1\.1k<\/b> followers/);
  assert.match(cards[2].followers, /<b>12\.5M<\/b> followers/);
  assert.match(cards[3].followers, /<b>800<\/b> followers/);
  assert.equal(cards[0].handle, '@exa');
  assert.equal(cards[2].handle, 'Jane Doe', 'a linkedin handle loses its in/ prefix, gets no @ and reads as a name');
  // An unsafe url is a build error upstream; the card renderer also refuses it, so it can never become a link.
  assert.throws(() => render(...Object.values(withPosts([], [acct('x', 'evil', 'company', 5000, { url: 'javascript:alert(1)' })]))), /"url" must be an http\(s\) link/);
  for (const c of cards) assert.match(c.html, /^ href="https:\/\/[^"]+" target="_blank" rel="noopener noreferrer" title="/, 'external, opens safely');
});

test('channel cards: unknown followers show no count, never 0; a handle keeps its written case', () => {
  const { evidence, analysis } = withPosts([], [
    acct('instagram', 'a', 'company', null),
    acct('tiktok', 'b', 'company', 0),
    acct('x', 'ExaAILabs', 'company', undefined),
    acct('x', 'd', 'founder', Number.NaN),
  ]);
  const cards = chanCards(organic(evidence, analysis));
  assert.equal(cards.length, 4);
  for (const c of cards) {
    assert.match(c.followers, /^<span class="muted">[A-Za-z]+<\/span>$/, `${c.name} ${c.handle}: the platform name, no follower count`);
    assert.ok(!/<b>/.test(c.followers) && !/\d/.test(c.followers), 'no number, least of all 0');
    assert.match(c.stats, /^No posts collected$/);
  }
  assert.ok(cards.some((c) => c.handle === '@ExaAILabs'), 'the handle is shown as the account writes it');
  assert.ok(!/Followers not visible|Followers:/.test(sectionOf(render(evidence, analysis).html, 's-organic')), 'no placeholder text for a missing count');
});

test('channel cards: stats come from the posts we sampled (count, typical or best engagement, latest date), matched by platform and handle', () => {
  const { evidence, analysis } = withPosts([
    post('ig1', 'instagram', { account: 'Exa', published: '2026-10-10', metrics: { likes: 10, comments: 2 } }),
    post('ig2', 'instagram', { account: 'exa', published: '2026-10-18', metrics: { likes: 30, comments: 4 } }),
    post('tt1', 'tiktok', { account: 'other', published: '2026-10-01', metrics: { likes: 99 } }),
  ], [
    acct('instagram', '@exa', 'company', 386000, { url: 'https://www.instagram.com/exa/' }),
    acct('tiktok', 'exa', 'company', 50, { url: 'https://www.tiktok.com/@exa' }),
  ]);
  const [ig, tt] = chanCards(organic(evidence, analysis));
  assert.equal(ig.name, 'Instagram');
  assert.match(ig.stats, /^2 posts sampled/, 'handle matching ignores case and a leading @');
  assert.match(ig.stats, /latest 18 Oct$/);
  assert.match(ig.stats, /engagements/);
  assert.equal(tt.stats, 'No posts collected', 'a post by a different account does not count');
  const one = withPosts([post('ig9', 'instagram', { account: 'exa', metrics: { likes: 7 } })], [acct('instagram', 'exa', 'company', 10)]);
  assert.match(chanCards(organic(one.evidence, one.analysis))[0].stats, /^1 post sampled/, 'singular for one post');
});

test('channel cards: hostile handle, platform and url text is escaped', () => {
  const XSS = '<img src=x onerror=alert(1)>';
  const { evidence, analysis } = withPosts([], [
    acct('x', XSS, 'company', 10, { url: 'https://x.com/a?b=1&c=2' }),
    acct(XSS, 'plain', 'founder', 10, { url: 'https://x.example/plain' }),
  ]);
  const { html } = render(evidence, analysis);
  const sec = sectionOf(html, 's-organic');
  assert.ok(!html.includes('<img src=x'), 'no raw markup');
  assert.ok(sec.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(sec.includes('href="https://x.com/a?b=1&amp;c=2"'), 'the url is escaped in the href');
  // The renderer itself, fed an unsafe url directly, draws nothing for it.
  assert.equal(renderChannelCards({ accounts: [acct('x', 'evil', 'company', 5, { url: 'javascript:alert(1)' })], posts: [] }, '2026-10-20'), '');
});

test('channel cards: absent when there are no accounts (or none with a safe url); inside section#s-organic before the first article.act', () => {
  const none = withPosts([], []);
  assert.equal(renderChannelCards({ accounts: [], posts: [] }, '2026-10-20'), '');
  assert.equal(renderChannelCards({ accounts: [acct('x', 'z', 'company', 5, { url: 'ftp://x.test/z' })], posts: [] }, '2026-10-20'), '');
  assert.ok(!organic(none.evidence, none.analysis).includes('class="chans"'));
  const { evidence, analysis } = withPosts([], [acct('x', 'exa', 'company', 10)]);
  const sec = organic(evidence, analysis);
  assert.ok(sec.startsWith('<section id="s-organic"'));
  const cardsAt = sec.indexOf('<div class="chans"');
  const firstAct = sec.search(/<article class="act/);
  assert.ok(cardsAt > sec.indexOf('</h2>'), 'after the section heading');
  assert.ok(cardsAt > 0 && cardsAt < firstAct, 'before the first activity block');
  const html = render(evidence, analysis).html;
  assert.equal((html.match(/class="chans"/g) ?? []).length, 1, 'only the organic section has cards');
  assert.ok(!paneOf(html, 'organic_social').includes('class="chans"') && !paneOf(html, 'founder_social').includes('class="chans"'), 'not inside an activity block');
});
