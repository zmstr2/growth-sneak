import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderReport } from '../scripts/render.mjs';
import { ACTIVITIES } from '../scripts/rubric.mjs';
import { SECTIONS, TOP_PLAYS, pickPlays } from '../scripts/scoreboard.mjs';
import { allScores, paneOf, sectionOf, ACT_RE } from './helpers.mjs';

const FIXES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const EXA = join(FIXES, 'exa.ai');
const NOTION = join(FIXES, 'notion.com');
const load = (dir) => ({
  evidence: JSON.parse(readFileSync(join(dir, 'evidence.json'), 'utf8')),
  analysis: JSON.parse(readFileSync(join(dir, 'analysis.json'), 'utf8')),
});
const run = (dir, mutate = () => {}, scores = null) => {
  const { evidence, analysis } = load(dir);
  mutate(evidence, analysis);
  return renderReport(evidence, analysis, { baseDir: dir, scores });
};
const sc = (score, confidence = 0.9, basis = 'jev', ev = 'E001') => ({ score, confidence, basis, evidence_ids: [ev] });

const SHOWN = ACTIVITIES; // every rubric activity is shown
// The hero's growth-play cards as { id, name, score, low, read }, in the order drawn.
const plays = (html) => {
  const box = html.split('<div class="plays">')[1]?.split('</div>')[0] ?? '';
  return box.split('<a class="gplay"').slice(1).map((c) => ({
    id: c.match(/href="#a-([\w]+)"/)[1],
    name: c.match(/class="pname">([^<]*)</)[1],
    score: Number(c.match(/class="pscore s-[gan]">(\d+)</)[1]),
    band: c.match(/class="pscore (s-[gan])"/)[1],
    low: /class="plow">Low confidence</.test(c),
    read: c.match(/class="pread">([^<]*)</)[1],
    go: /class="pgo">See details</.test(c),
  }));
};
// The score element of one activity block: { band, word, text } (band is null for Not covered).
// text is the number or the words "Not covered"; the "/100" suffix is a <small> and is not part of it.
const ascore = (html, id) => {
  const m = paneOf(html, id).match(/<span class="ascore(?: (s-[gan]))?( word)?">([^<]+)(?:<small>\/100<\/small>)?<\/span>/);
  return m && { band: m[1] ?? null, word: Boolean(m[2]), text: m[3] };
};
const takeaway = (over = {}) => ({ activity: 'google_ads', move: 'Test more angles.', observed: 'Many ads run for months.', evidence_ids: ['E001'], ...over });

// ---------- (1) order and states ----------

test('scores: growth plays are scored activities high to low; checked absence and not covered are never plays, and say so in their own block', () => {
  const scores = { activities: {
    seo_content: sc(55), google_ads: sc(90), comparison: sc(72), pricing: sc(10),
    aeo: { score: 0, confidence: 0.8, basis: 'checked_absence', evidence_ids: ['E001'] },
    video: { score: null, confidence: null, basis: 'not_covered', evidence_ids: [] },
  } };
  const { html } = run(EXA, () => {}, scores);
  const cards = plays(html);
  assert.deepEqual(cards.map((c) => c.id), ['google_ads', 'comparison', 'seo_content'], 'only scored activities, high to low; pricing at 10 is under the steady line so it is no play');
  assert.deepEqual(cards.map((c) => c.score), [90, 72, 55]);
  assert.equal(ascore(html, 'pricing').text, '10', 'but its block still shows the score');
  // A checked absence is a written 0 with its reason; it is not a play.
  assert.deepEqual(ascore(html, 'aeo'), { band: 's-n', word: false, text: '0' });
  assert.match(paneOf(html, 'aeo'), /<p class="asub">Checked, none found<\/p>/);
  // Everything else says Not covered with no number, and never "none found".
  for (const a of SHOWN) {
    if (['google_ads', 'comparison', 'seo_content', 'pricing', 'aeo'].includes(a.id)) continue;
    assert.deepEqual(ascore(html, a.id), { band: null, word: true, text: 'Not covered' }, `${a.id} must say Not covered, no number`);
    const block = paneOf(html, a.id);
    assert.ok(!/class="ascore s-/.test(block), 'a not-covered block never shows a number');
    assert.ok(!/Checked, none found/.test(block), 'not covered is not absent');
    assert.match(block, /We could not look at this in this run, so it has no score\./, 'it says why there is no number');
  }
});

test('hero: at most six growth-play cards, each linking to an activity block that exists, at most two per section, hygiene last', () => {
  const { evidence } = load(EXA);
  const full = allScores(evidence, { video: null, events: null, referral: null });
  const { html } = run(EXA, () => {}, full);
  const cards = plays(html);
  assert.equal(TOP_PLAYS, 6);
  assert.equal(cards.length, 6, 'capped at six although more activities are scored');
  const secOf = (id) => SECTIONS.find((x) => x.activities.includes(id)).id;
  const perSection = {};
  for (const c of cards) perSection[secOf(c.id)] = (perSection[secOf(c.id)] ?? 0) + 1;
  assert.ok(Object.values(perSection).every((n) => n <= 2), `at most two per section: ${JSON.stringify(perSection)}`);
  assert.ok(!cards.some((c) => ['aeo', 'pricing', 'seo_content'].includes(c.id)), 'plain hygiene is passed over while enough other activities are scored');
  for (const c of cards) {
    assert.ok(ACT_RE(c.id).test(html), `#a-${c.id} does not exist`);
    assert.ok(c.go, 'each card says See details');
    assert.ok(c.name && c.read, 'each card has a name and a one-sentence read');
    assert.equal(c.score, full.activities[c.id].score, 'the card shows the real score');
  }
  assert.equal(new Set(cards.map((c) => c.id)).size, 6);
  // Fewer than six scored: only those are drawn, hygiene included once nothing else is left.
  const two = run(EXA, () => {}, { activities: { google_ads: sc(80), pricing: sc(50) } }).html;
  assert.deepEqual(plays(two).map((c) => c.id), ['google_ads', 'pricing']);
  // The card uses the analyst's read when there is one.
  const withRead = run(EXA, (ev, an) => { an.reads = [{ activity: 'google_ads', read: 'Ads run for years.', evidence_ids: ['E001'] }]; }, { activities: { google_ads: sc(80) } }).html;
  assert.equal(plays(withRead)[0].read, 'Ads run for years.');
});

// ---------- pickPlays ----------

const PS = (o) => ({ activities: Object.fromEntries(Object.entries(o).map(([id, v]) => [id, Array.isArray(v) ? sc(v[0], v[1]) : sc(v)])) });
const ids = (list) => list.map((r) => r.id);

test('pickPlays: the analyst\'s plays win over higher scores and keep their order; the rest fills by score', () => {
  const scores = PS({ google_ads: 95, organic_social: 90, comparison: 85, pricing: 30, aeo: 20, press: 80 });
  const picked = pickPlays(scores, { plays: [{ activity: 'pricing' }, { activity: 'aeo' }, { activity: 'google_ads' }], takeaways: [{ activity: 'press' }] });
  assert.deepEqual(ids(picked).slice(0, 3), ['pricing', 'aeo', 'google_ads'], 'analyst order, even though they score lower');
  assert.deepEqual(ids(picked), ['pricing', 'aeo', 'google_ads'], 'only the analyst\'s plays: no padding, takeaways ignored');
  assert.deepEqual(ids(pickPlays(scores, { plays: [{ activity: 'pricing' }, { activity: 'pricing' }] })).filter((x) => x === 'pricing'), ['pricing'], 'no repeats');
  // The cap applies to the analyst too.
  const many = PS(Object.fromEntries(['google_ads', 'organic_social', 'founder_social', 'video', 'comparison', 'customer_proof', 'press', 'events'].map((id, i) => [id, 90 - i])));
  assert.equal(pickPlays(many, { plays: Object.keys(many.activities).map((activity) => ({ activity })) }).length, 6);
});

test('pickPlays: with no plays the takeaways\' activities lead, in order', () => {
  const scores = PS({ google_ads: 95, organic_social: 90, pricing: 30, video: 25 });
  const picked = pickPlays(scores, { takeaways: [{ activity: 'video' }, { activity: 'pricing' }] });
  assert.deepEqual(ids(picked).slice(0, 2), ['video', 'pricing'], 'a hygiene takeaway is allowed because the analyst chose it');
  assert.deepEqual(ids(picked).slice(2), ['google_ads', 'organic_social']);
});

test('pickPlays: without plays, hygiene and low-confidence activities are skipped while enough others exist, at most two per section', () => {
  const scores = PS({
    google_ads: 95, seo_content: 94, aeo: 93, pricing: 92,
    organic_social: 90, founder_social: 89, video: 88,
    comparison: [87, 0.3], customer_proof: 86, press: 85, events: 84, community: 83,
  });
  const picked = pickPlays(scores, {});
  assert.deepEqual(ids(picked), ['google_ads', 'organic_social', 'founder_social', 'customer_proof', 'press', 'events']);
  assert.ok(!ids(picked).some((x) => ['seo_content', 'aeo', 'pricing'].includes(x)), 'hygiene skipped');
  assert.ok(!ids(picked).includes('comparison'), 'low confidence skipped');
  assert.ok(!ids(picked).includes('video'), 'a third organic-social card is passed over');
  // When there are not enough good candidates, hygiene and low confidence fill the rest, in score order.
  const thin = pickPlays(PS({ google_ads: 80, seo_content: 90, aeo: 85, comparison: [70, 0.2] }), {});
  assert.deepEqual(ids(thin), ['google_ads', 'seo_content', 'aeo', 'comparison']);
  // Checked absences and not-covered activities are never candidates.
  const none = { activities: { aeo: { score: 0, confidence: 0.8, basis: 'checked_absence', evidence_ids: ['E001'] }, video: { score: null, basis: 'not_covered', evidence_ids: [] } } };
  assert.deepEqual(pickPlays(none, { plays: [{ activity: 'aeo' }, { activity: 'video' }] }), []);
});

test('plays: unknown and unscored activities from the analyst are dropped with a warning; valid ones still lead the hero in order', () => {
  const scores = { activities: { google_ads: sc(60), pricing: sc(50), organic_social: sc(40), aeo: { score: 0, confidence: 0.8, basis: 'checked_absence', evidence_ids: ['E001'] } } };
  const r = run(EXA, (ev, an) => {
    an.plays = [{ activity: 'ghost_activity' }, { activity: 'video' }, { activity: 'sales_motion' }, { activity: 'aeo' }, { activity: 'pricing' }, { activity: 'google_ads' }];
  }, scores);
  const cards = plays(r.html);
  assert.deepEqual(cards.map((c) => c.id).slice(0, 2), ['pricing', 'google_ads'], 'the valid picks, in the analyst\'s order');
  assert.ok(!cards.some((c) => ['video', 'sales_motion', 'aeo'].includes(c.id)));
  assert.ok(r.warnings.some((w) => /plays: dropped an entry for unknown activity "ghost_activity"/.test(w)));
  assert.ok(r.warnings.some((w) => /plays: dropped "video" \(it has no score/.test(w)), 'not covered');
  assert.ok(r.warnings.some((w) => /plays: dropped "aeo" \(it has no score/.test(w)), 'a checked absence is not a play');
  assert.ok(r.warnings.some((w) => /plays: dropped an entry for unknown activity "sales_motion"/.test(w)), 'a retired activity is simply unknown');
  assert.ok(!r.html.includes('sales_motion'));
});

test('scores: a no_answer entry is not covered, not 0', () => {
  const scores = { activities: { google_ads: sc(80), pricing: { score: null, level: null, confidence: null, basis: 'no_answer', evidence_ids: ['E001'] } } };
  const { html } = run(EXA, () => {}, scores);
  assert.ok(!plays(html).some((c) => c.id === 'pricing'), 'a no_answer activity is not a play');
  assert.deepEqual(ascore(html, 'pricing'), { band: null, word: true, text: 'Not covered' });
  assert.match(sectionOf(html, 'gaps'), /Not scored:<\/b>[^<]*Pricing/, 'and the closing section names it as not scored');
});

// ---------- (2) low confidence ----------

test('scores: confidence under 0.5 says "low confidence" in words, on the card and in the block', () => {
  const scores = { activities: { google_ads: sc(80, 0.49), seo_content: sc(75, 0.5), comparison: sc(45, 0.2), pricing: sc(60, null) } };
  const { html } = run(EXA, () => {}, scores);
  const by = Object.fromEntries(plays(html).map((c) => [c.id, c]));
  for (const id of ['google_ads', 'comparison']) {
    assert.ok(by[id].low, `${id} card says low confidence`);
    assert.match(paneOf(html, id), /<p class="asub">Low confidence<\/p>/, 'the block says it in words too');
  }
  for (const id of ['seo_content', 'pricing']) {
    assert.ok(!by[id].low, `${id} is not low`);
    assert.ok(!/Low confidence/.test(paneOf(html, id)));
  }
  assert.equal(by.google_ads.score, 80, 'the score is still shown beside the words');
  assert.deepEqual(ascore(html, 'google_ads'), { band: 's-g', word: false, text: '80' });
});

// ---------- (3) bands ----------

test('scores: 70 or more is s-g (green), 40 to 69 steady, below 40 light; cards and blocks use the same bands', () => {
  const scores = { activities: { google_ads: sc(95), seo_content: sc(88), comparison: sc(81), pricing: sc(70), aeo: sc(69), video: sc(40), events: sc(39) } };
  const { html } = run(EXA, () => {}, scores);
  const cards = plays(html);
  assert.deepEqual(cards.map((c) => c.id), ['google_ads', 'comparison', 'video', 'events', 'seo_content', 'pricing'], 'hygiene (seo_content, pricing, aeo) is picked last, so aeo misses the six');
  const by = Object.fromEntries(cards.map((c) => [c.id, c]));
  for (const id of ['google_ads', 'seo_content', 'comparison', 'pricing']) assert.equal(by[id].band, 's-g', `${id} is strong`);
  assert.equal(by.video.band, 's-a');
  assert.equal(by.events.band, 's-n', '39 is light');
  assert.equal(ascore(html, 'pricing').band, 's-g');
  assert.equal(ascore(html, 'aeo').band, 's-a');
  assert.equal(ascore(html, 'events').band, 's-n');
  assert.equal(ascore(html, 'video').band, 's-a');
  assert.ok(!cards.filter((c) => c.score < 70).some((c) => c.band === 's-g'), 'green is reserved for 70 and above');
});

// ---------- (4) takeaways ----------

test('takeaways render move, cited observation and a See details link; fits/skip are gone; one missing observed or move, or with no evidence ids, is dropped with a warning', () => {
  const scores = { activities: { google_ads: sc(80), pricing: sc(50) } };
  const r = run(EXA, (ev, an) => {
    an.takeaways = [
      takeaway(),
      takeaway({ activity: 'pricing', observed: '' }),
      takeaway({ activity: 'seo_content', evidence_ids: [] }),
    ];
  }, scores);
  const take = sectionOf(r.html, 'take');
  assert.match(take, /<h2[^>]*>What you can take from this<\/h2>/);
  assert.match(take, /<ol class="takes">/);
  assert.match(take, /<h3>Test more angles\.<\/h3>/);
  assert.match(take, /Many ads run for months\./);
  assert.match(take, /<button class="fn"[^>]*aria-controls="fp\d+"/, 'the observation is cited with expandable footnote buttons');
  assert.match(take, /<a class="btn" href="#a-google_ads">See details<\/a>/);
  assert.ok(!/Fits when|Skip when/.test(r.html), 'no fits or skip lines any more');
  assert.equal((take.match(/<li class="take"/g) ?? []).length, 1, 'only the complete, cited takeaway is shown');
  assert.ok(r.warnings.some((w) => /takeaways: dropped "pricing" \(needs observed and move\)/.test(w)));
  assert.ok(r.warnings.some((w) => /takeaways: dropped a claim with no evidence ids/.test(w)));
  // A takeaway now needs only observed + move + evidence.
  const lean = run(EXA, (ev, an) => { an.takeaways = [takeaway()]; }, scores);
  assert.equal((sectionOf(lean.html, 'take').match(/<li class="take"/g) ?? []).length, 1);
  assert.deepEqual(lean.warnings, []);
  const none = run(EXA, (ev, an) => { an.takeaways = [takeaway({ evidence_ids: [] })]; }, scores);
  assert.ok(!none.html.includes('What you can take from this'), 'no section when every takeaway was dropped');
  assert.ok(!none.html.includes('id="take"'));
});

test('every takeaway See details link targets an activity block that exists (also for activities we could not cover)', () => {
  const { evidence } = load(EXA);
  const scores = allScores(evidence, { video: null });
  const r = run(EXA, (ev, an) => {
    an.takeaways = [takeaway(), takeaway({ activity: 'pricing' }), takeaway({ activity: 'seo_content' }), takeaway({ activity: 'video' })];
  }, scores);
  assert.ok(r.warnings.some((w) => /video/.test(w)), 'the takeaway on a not-covered activity is dropped with a warning');
  const links = [...sectionOf(r.html, 'take').matchAll(/<a class="btn" href="#(a-[\w]+)">See details<\/a>/g)].map((m) => m[1]);
  assert.deepEqual(links, ['a-google_ads', 'a-pricing', 'a-seo_content']);
  for (const href of links) assert.ok(ACT_RE(href.slice(2)).test(r.html), `${href} is missing`);
});

test('a scores.json activity the rubric does not know (the retired sales_motion) is ignored with a warning, and the page renders without it', () => {
  const { evidence } = load(EXA);
  const scores = allScores(evidence);
  scores.activities.sales_motion = sc(99); // an older scores.json still has it

  const r = run(EXA, (ev, an) => {
    an.reads = [{ activity: 'sales_motion', read: 'Hiring signals a Zebra sales push.', evidence_ids: ['E001'] }];
    an.takeaways = [takeaway({ activity: 'sales_motion', move: 'Hire a Zebra seller.' }), takeaway()];
  }, scores);
  assert.ok(r.warnings.includes('scores.json: ignored unknown activity "sales_motion"'), r.warnings.join(' | '));
  assert.ok(r.warnings.some((w) => /reads: dropped an entry for unknown activity "sales_motion"/.test(w)));
  assert.ok(r.warnings.some((w) => /takeaways: dropped an entry for unknown activity "sales_motion"/.test(w)));
  const { html } = r;
  assert.ok(!html.includes('sales_motion') && !html.includes('Sales motion'), 'no id, anchor, link or label for it');
  assert.ok(!/Zebra/.test(html), 'neither its read nor its takeaway');
  assert.ok(!plays(html).some((c) => c.id === 'sales_motion'), 'not a play, though it is the best score');
  assert.ok(!/Not scored:[^<]*Sales/.test(html), 'and not counted as "not scored" either');
  assert.equal((sectionOf(html, 'take').match(/<li class="take"/g) ?? []).length, 1, 'the valid takeaway is unaffected');
  // The same run without the retired activity anywhere gives exactly the same page.
  const clean = run(EXA, (ev, an) => { an.takeaways = [takeaway()]; }, allScores(evidence));
  assert.deepEqual(clean.warnings, []);
  assert.equal(html.split('<footer class="about')[0], clean.html.split('<footer class="about')[0], 'the page is what the same scores without it give');
  assert.match(html.split('<footer class="about')[1], /3 items were left out or flagged when the page was built/, 'only the footer counts what was left out');
});

test('an unknown activity in scores.json is ignored whatever it cites: its evidence ids are not checked, other scores still are', () => {
  const r = run(EXA, () => {}, { activities: { made_up: sc(80, 0.9, 'jev', 'E999'), google_ads: sc(70) } });
  assert.deepEqual(r.warnings, ['scores.json: ignored unknown activity "made_up"']);
  assert.deepEqual(plays(r.html).map((c) => c.id), ['google_ads']);
  assert.ok(!r.html.includes('made_up'));
  assert.equal(ascore(r.html, 'google_ads').text, '70');
  // Every other activity is still drawn, as Not covered.
  assert.equal([...r.html.matchAll(/<article class="act un" id="a-/g)].length, ACTIVITIES.length - 1);
});

// ---------- (5) unknown ids ----------

test('reads and takeaways for an unknown activity are dropped with a warning', () => {
  const scores = { activities: { google_ads: sc(80) } };
  const r = run(EXA, (ev, an) => {
    an.reads = [{ activity: 'not_a_real_activity', read: 'Phantom read text.', evidence_ids: ['E001'] }, { activity: 'google_ads', read: 'Real read text.', evidence_ids: ['E001'] }];
    an.takeaways = [takeaway({ activity: 'ghost_activity' }), takeaway()];
  }, scores);
  assert.ok(r.warnings.some((w) => /reads: dropped an entry for unknown activity "not_a_real_activity"/.test(w)));
  assert.ok(r.warnings.some((w) => /takeaways: dropped an entry for unknown activity "ghost_activity"/.test(w)));
  assert.ok(!r.html.includes('Phantom read text.'));
  assert.match(r.html, /Real read text\./);
});

test('scores and reads citing an unknown evidence id make renderReport throw (the data is broken)', () => {
  assert.throws(() => run(EXA, () => {}, { activities: { google_ads: sc(80, 0.9, 'jev', 'E999') } }), /scores\.json: google_ads cites unknown evidence id E999/);
  assert.throws(() => run(EXA, (ev, an) => { an.reads = [{ activity: 'google_ads', read: 'x', evidence_ids: ['E999'] }]; }, { activities: { google_ads: sc(80) } }), /unknown evidence id E999/);
});

// ---------- (6) no scores / analyst fallback ----------

test('with no scores and no activity_levels there are no plays, takeaways or activity sections, and the page still renders', () => {
  const r = run(NOTION);
  assert.ok(!r.html.includes('class="plays"') && !r.html.includes('Their strongest growth plays'));
  assert.ok(!r.html.includes('id="take"'));
  assert.ok(!/<section id="s-/.test(r.html) && !/<article class="act/.test(r.html), 'no activity sections without scores');
  assert.match(r.html, /<header id="summary" class="hero"/);
  assert.match(r.html, /<h1>Notion<\/h1>/);
  assert.match(r.html, /<p class="lede">/);
  assert.ok(r.html.includes('id="tech"') && r.html.includes('id="gaps"'), 'tech and gaps do not depend on scores');
  // And an explicit empty scores object draws no plays either.
  const empty = run(NOTION, () => {}, { activities: {} }).html;
  assert.ok(!empty.includes('class="plays"'));
  assert.match(ascore(empty, 'google_ads').text, /^Not covered$/, 'with nothing scored every block says Not covered');
});

test('analyst fallback: activity_levels become scores, so the page has plays and activity blocks without scores.json', () => {
  const r = run(EXA, (ev, an) => {
    an.activity_levels = [{ activity: 'google_ads', level: 3, evidence_ids: ['E001'] }, { activity: 'seo_content', level: 2, evidence_ids: ['E011'] }];
  });
  const cards = plays(r.html);
  assert.deepEqual(cards.map((c) => c.id).sort(), ['google_ads', 'seo_content']);
  assert.ok(cards[0].score >= cards[1].score, 'the higher level ranks first');
  assert.match(ascore(r.html, 'google_ads').text, /^\d+$/);
  // Everything the levels did not rate is not covered, not 0.
  assert.deepEqual(ascore(r.html, 'pricing'), { band: null, word: true, text: 'Not covered' });
});

// ---------- (7) activity blocks and anchors ----------

test('every shown activity has one article#a-<id>, inside its section; every in-page activity link lands on one', () => {
  const scores = { activities: { google_ads: sc(80), seo_content: sc(60), pricing: sc(30) } };
  const { html } = run(EXA, () => {}, scores);
  for (const a of SHOWN) {
    assert.equal((html.match(new RegExp(ACT_RE(a.id).source, 'g')) ?? []).length, 1, `block for ${a.id}`);
    const sec = SECTIONS.find((x) => x.activities.includes(a.id));
    assert.ok(sectionOf(html, `s-${sec.id}`).includes(`id="a-${a.id}"`), `${a.id} sits in section ${sec.id}`);
  }
  for (const m of html.matchAll(/href="#(a-[\w]+)"/g)) assert.ok(html.includes(`id="${m[1]}"`), `${m[1]} has no block`);
  // The old tabbed panes are gone.
  assert.ok(!/class="sc-detail"|class="srow|class="stagecard|id="p-[\w]+"/.test(html));
});

// ---------- (8) headline ----------

test('the headline is the lede, escaped, with external arrow links; an uncited headline falls back to the summary', () => {
  const hostile = '<img src=x onerror=alert(1)> & "quoted" <script>alert(2)</script>';
  const scores = { activities: { google_ads: sc(80) } };
  const r = run(EXA, (ev, an) => { an.headline = { text: hostile, evidence_ids: ['E001', 'E002', 'E003'] }; }, scores);
  const lede = r.html.match(/<p class="lede">([\s\S]*?)<\/p>/)[1];
  assert.ok(lede.includes('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quoted&quot; &lt;script&gt;alert(2)&lt;/script&gt;'));
  assert.ok(!r.html.includes('<img src=x'), 'no raw markup from the headline');
  assert.equal((r.html.match(/<script>/g) ?? []).length, 1, 'only the template script exists');
  const links = [...lede.matchAll(/<a class="fnlink" href="([^"]+)" target="_blank" rel="noopener noreferrer"[^>]*>↗<\/a>/g)];
  assert.equal(links.length, 2, 'at most two arrow links, although three items are cited');
  assert.ok(links.every((m) => /^https?:\/\//.test(m[1])), 'they go to the evidence url, not to an in-page anchor');
  assert.match(r.html, /<h1>Exa<\/h1>/, 'the h1 is the company name');

  const { analysis } = load(EXA);
  const fb = run(EXA, (ev, an) => { an.headline = { text: 'Uncited headline text.', evidence_ids: [] }; }, scores);
  const ledeB = fb.html.match(/<p class="lede">([\s\S]*?)<\/p>/)[1];
  assert.ok(!fb.html.includes('Uncited headline text.'));
  assert.ok(ledeB.includes(analysis.summary.text.slice(0, 40).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')), 'the summary leads instead');
  assert.ok(fb.warnings.some((w) => /headline: dropped a claim with no evidence ids/.test(w)));
});

// ---------- activity blocks: no folds, a source line ----------

test('no activity block has a fold, a "Findings and sources" fold, a by-date list, charts, tables or open roles', () => {
  for (const dir of [EXA, NOTION]) {
    const { evidence } = load(dir);
    const { html } = run(dir, (ev) => { ev.roles = { evidence_id: ev.items[0].id, items: [{ title: 'Zebra Wrangler', function: 'Sales' }] }; }, allScores(evidence));
    const body = html.split('<main')[1];
    assert.ok(!/details class="fold2"|fold2|Findings and sources|What they did, by date|How their accounts perform|What they publish/.test(body), dir);
    for (const a of SHOWN) {
      const block = paneOf(html, a.id);
      assert.ok(!block.includes('<details') && !block.includes('<summary'), `${a.id}: no fold`);
      assert.ok(!/<table|<svg class="tchart"|class="tl |class="bars|class="plans|class="pair"|class="dp-row"|class="sb-row"/.test(block), `${a.id}: no chart or table`);
      assert.match(block, /^\s*<header class="aside">/, `${a.id}: the block starts with its header (name and score)`);
      assert.equal((block.match(/<p class="aread/g) ?? []).length, 1, `${a.id}: exactly one read`);
    }
    assert.ok(!/Zebra/.test(html), 'open roles are shown nowhere');
  }
});

test('source line: up to four external links labelled by host and path, de-duplicated by url, each named for what it supports', () => {
  const { evidence } = load(EXA);
  const scores = { activities: { google_ads: { score: 80, confidence: 0.9, basis: 'jev', evidence_ids: ['E001', 'E002', 'E003', 'E004', 'E005', 'E006', 'E007'] } } };
  const r = run(EXA, (ev, an) => {
    ev.items.slice(0, 7).forEach((it, i) => { it.url = `https://src${i}.example/p/${i}`; });
    ev.items[1].url = ev.items[0].url; // E002 repeats E001's url
    an.reads = [{ activity: 'google_ads', read: 'Read.', evidence_ids: ['E007'] }];
  }, scores);
  const block = paneOf(r.html, 'google_ads');
  const line = block.match(/<p class="srcline"><span class="slab">Sources<\/span>([\s\S]*?)<\/p>/)[1];
  const links = [...line.matchAll(/<a class="schip" href="([^"]+)" target="_blank" rel="noopener noreferrer" aria-label="Source for: [^"]+">([^<]+)<span aria-hidden="true"> ↗<\/span><\/a>/g)];
  assert.equal(links.length, 4, 'capped at four although seven items are cited');
  assert.ok(links.every((m) => /^https:\/\//.test(m[1])), 'all external');
  const hrefs = links.map((m) => m[1]);
  assert.equal(new Set(hrefs).size, 4, 'de-duplicated by url');
  assert.deepEqual(hrefs.slice(0, 2), ['https://src6.example/p/6', 'https://src0.example/p/0'], 'the read\'s own evidence comes first, then the score\'s');
  assert.equal(links[0][2], 'src6.example/p/6', 'labelled by host and path, not by "Source"');
  assert.ok(!/E00\d/.test(line), 'no visible evidence ids');
  // Hostile source text cannot add elements.
  const bad = run(EXA, (ev) => { ev.items[0].finding = '<img src=x onerror=alert(1)>'; ev.items[0].url = 'https://x.example/a?b=1&c=2'; }, { activities: { google_ads: sc(80) } });
  const l2 = paneOf(bad.html, 'google_ads').match(/<p class="srcline">[\s\S]*?<\/p>/)[0];
  assert.ok(!l2.includes('<img') && l2.includes('&lt;img'), 'finding text is escaped in the label');
  assert.ok(l2.includes('?b=1&amp;c=2'), 'url is escaped in the href');
});

test('source line: a checked absence shows the probe that was run, escaped; a scored block never claims a check', () => {
  const r = run(NOTION, (ev) => {
    ev.items.push({ id: 'E100', collector: 'owned', channel: 'comparison', status: 'observed', absent: true, probe: 'Searched sitemap for <b>/vs/</b> & /compare/', finding: 'No comparison pages.', url: 'https://www.notion.com/sitemap.xml', captured_at: '2026-10-20T03:00:00Z' });
  }, { activities: { comparison: { score: 0, confidence: 0.8, basis: 'checked_absence', evidence_ids: ['E100'] }, pricing: sc(50, 0.9, 'jev', 'E008') } });
  const c = paneOf(r.html, 'comparison');
  assert.match(c, /<p class="facts muted">Checked: Searched sitemap for &lt;b&gt;\/vs\/&lt;\/b&gt; &amp; \/compare\/<\/p>/);
  assert.match(c, /<p class="asub">Checked, none found<\/p>/);
  assert.match(c, /<p class="aread">We checked and found nothing\.<\/p>/);
  assert.match(c, /<span class="ascore s-n">0<small>\/100<\/small><\/span>/);
  assert.ok(!/Checked: /.test(paneOf(r.html, 'pricing')));
});

// ---------- score bar ----------

// The header of one activity block, and its bar: { cls, width } for a scored bar, or { dashed: true } for a not-covered one.
const headerOf = (html, id) => paneOf(html, id).match(/<header class="aside">([\s\S]*?)<\/header>/)[1];
const bar = (html, id) => {
  const h = headerOf(html, id);
  const full = h.match(/<span class="abar" aria-hidden="true"><i class="b-([gan])" style="width:(\d+)%"><\/i><\/span>/);
  if (full) return { band: full[1], width: Number(full[2]), dashed: false };
  return { dashed: /<span class="abar dashed" aria-hidden="true"><\/span>/.test(h), fill: /<i /.test(h) };
};

test('score bar: its width is the score and its colour is the same band as the number; the bar is decoration, the number is written beside it', () => {
  const scores = { activities: {
    google_ads: sc(95), comparison: sc(70), seo_content: sc(55), video: sc(40), events: sc(39), pricing: sc(7),
    aeo: sc(0), // scored zero: nothing found in what we collected, not a checked absence
  } };
  const { html } = run(EXA, () => {}, scores);
  const expected = { google_ads: 'g', comparison: 'g', seo_content: 'a', video: 'a', events: 'n', pricing: 'n', aeo: 'n' };
  for (const [id, band] of Object.entries(expected)) {
    const want = scores.activities[id].score;
    assert.deepEqual(bar(html, id), { band, width: want, dashed: false }, `${id}: width equals the score`);
    assert.deepEqual(ascore(html, id), { band: `s-${band}`, word: false, text: String(want) }, `${id}: number and bar agree`);
    assert.match(headerOf(html, id), new RegExp(`<span class="ascore s-${band}">${want}<small>/100</small></span>`));
  }
  assert.match(paneOf(html, 'aeo'), /<p class="asub">Nothing found in what we collected<\/p>/, 'a scored 0 says what it is');
  assert.ok(!/Checked, none found/.test(paneOf(html, 'aeo')), 'and does not claim a check');
  // A checked absence is a 0 with a solid empty bar (the check was made), not a dashed one.
  const abs = run(EXA, () => {}, { activities: { aeo: { score: 0, confidence: 0.8, basis: 'checked_absence', evidence_ids: ['E001'] } } }).html;
  assert.deepEqual(bar(abs, 'aeo'), { band: 'n', width: 0, dashed: false });
  assert.match(headerOf(abs, 'aeo'), /<span class="ascore s-n">0<small>\/100<\/small><\/span>/);
  // Rounded scores: the bar and the number use the same whole number.
  const odd = run(EXA, () => {}, { activities: { google_ads: sc(72.6) } }).html;
  assert.deepEqual(bar(odd, 'google_ads'), { band: 'g', width: 73, dashed: false });
  assert.equal(ascore(odd, 'google_ads').text, '73');
});

test('score bar: not covered blocks have a dashed bar with no fill and no digits anywhere in the header; the score words say why', () => {
  const scores = { activities: { google_ads: sc(80), pricing: { score: null, level: null, confidence: null, basis: 'no_answer', evidence_ids: ['E001'] } } };
  const { html } = run(EXA, () => {}, scores);
  const uncovered = SHOWN.filter((a) => a.id !== 'google_ads');
  assert.ok(uncovered.length > 10);
  for (const a of uncovered) {
    assert.deepEqual(bar(html, a.id), { dashed: true, fill: false }, `${a.id}: dashed, nothing drawn inside`);
    const h = headerOf(html, a.id);
    assert.ok(!/\d/.test(h.replace(/<h3>[^<]*<\/h3>/, '')), `${a.id}: no digit in the header (${h})`);
    assert.ok(!/\/100|class="ascore s-|width:|b-[gan]/.test(paneOf(html, a.id)), `${a.id}: no score, band or width anywhere in the block`);
    assert.match(h, /<span class="ascore word">Not covered<\/span>/);
    assert.match(paneOf(html, a.id), /<div class="abody"><p class="aread muted">We could not look at this in this run, so it has no score\.<\/p><\/div>/);
  }
  assert.ok(html.includes('<article class="act un" id="a-pricing">'), 'a not-covered block is marked un');
  assert.ok(!html.includes('<article class="act" id="a-pricing">'));
  // Scores present but empty: every block is dashed, never a zero-width bar.
  const none = run(NOTION, () => {}, { activities: {} }).html;
  for (const a of SHOWN) assert.equal(bar(none, a.id).dashed, true, `${a.id} with an empty score set`);
});

// ---------- sections and the rubric ----------

test('every rubric activity appears in exactly one SECTIONS entry, and every SECTIONS entry names a rubric activity', () => {
  const rubric = ACTIVITIES.map((a) => a.id);
  const listed = SECTIONS.flatMap((x) => x.activities);
  for (const id of rubric) {
    const in_ = SECTIONS.filter((x) => x.activities.includes(id));
    assert.equal(in_.length, 1, `${id} is in ${in_.length} sections: ${in_.map((x) => x.id).join(', ') || 'none'}`);
  }
  for (const id of listed) assert.ok(rubric.includes(id), `section lists "${id}", which the rubric does not have`);
  assert.equal(listed.length, rubric.length, 'no activity is listed twice in one section');
  assert.equal(new Set(SECTIONS.map((x) => x.id)).size, SECTIONS.length, 'section ids are unique');
  for (const x of SECTIONS) assert.ok(x.activities.length >= 1, `section ${x.id} is empty`);
  assert.equal(ACTIVITIES.length, 17);
});
