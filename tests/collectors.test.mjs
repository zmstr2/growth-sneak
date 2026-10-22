import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSitemapXml, robotsSitemaps, findLocalePrefixes, isLocaleCopy, summarize } from '../scripts/sitemap.mjs';
import { parseRobots, botAccess, headFacts, toChecks } from '../scripts/sitecheck.mjs';
import { classify } from '../scripts/techstack.mjs';

// ---------- sitemap ----------

test('parses urlsets and sitemap indexes, with lastmod and entity decoding', () => {
  const idx = parseSitemapXml('<?xml version="1.0"?><sitemapindex><sitemap><loc>https://a.com/s1.xml</loc></sitemap></sitemapindex>');
  assert.equal(idx.isIndex, true);
  assert.deepEqual(idx.entries, [{ loc: 'https://a.com/s1.xml', lastmod: null }]);
  const set = parseSitemapXml('<urlset><url><loc>https://a.com/x?a=1&amp;b=2</loc><lastmod>2026-10-01</lastmod></url></urlset>');
  assert.equal(set.isIndex, false);
  assert.deepEqual(set.entries, [{ loc: 'https://a.com/x?a=1&b=2', lastmod: '2026-10-01' }]);
});

test('reads Sitemap lines from robots.txt', () => {
  assert.deepEqual(robotsSitemaps('User-agent: *\nSitemap: https://a.com/s.xml\nsitemap:https://b.a.com/t.xml'), ['https://a.com/s.xml', 'https://b.a.com/t.xml']);
});

test('locale prefixes must repeat; a real two-letter section like /md/ is not a language', () => {
  const urls = [
    'https://www.notion.com/sitemap.xml', 'https://www.notion.com/blog/sitemap.xml', 'https://www.notion.com/help/sitemap.xml',
    'https://www.notion.com/md/sitemap.xml',
    'https://www.notion.com/es/blog/sitemap.xml', 'https://www.notion.com/es/help/sitemap.xml', 'https://www.notion.com/es/md/sitemap.xml',
    'https://www.notion.com/pt-br/blog/sitemap.xml', 'https://www.notion.com/pt-br/help/sitemap.xml', 'https://www.notion.com/pt-br/sitemap.xml',
  ];
  const locales = findLocalePrefixes(urls);
  assert.deepEqual(locales, ['es', 'pt-br']);
  assert.equal(isLocaleCopy('https://www.notion.com/md/sitemap.xml', locales), false);
  assert.equal(isLocaleCopy('https://www.notion.com/es/blog/x', locales), true);
});

test('summarize groups sections, folds tiny ones, breaks down big ones, and counts recent updates', () => {
  const pages = [];
  for (let i = 0; i < 600; i++) pages.push({ loc: `https://www.a.com/templates/${i < 400 ? 'collections' : 'category'}/t${i}`, lastmod: i < 10 ? '2026-10-01' : '2024-01-01' });
  for (let i = 0; i < 6; i++) pages.push({ loc: `https://www.a.com/blog/p${i}`, lastmod: null });
  pages.push({ loc: 'https://www.a.com/pricing', lastmod: null }, { loc: 'https://www.a.com/login', lastmod: null });
  pages.push({ loc: 'https://www.a.com/blog/p0', lastmod: null }); // duplicate
  const s = summarize(pages, { domain: 'a.com', asOf: '2026-10-20' });
  assert.equal(s.total_urls, 608);
  assert.equal(s.sections[0].path, '/templates');
  assert.equal(s.sections[0].updated_90d, 10);
  assert.deepEqual(s.sections[0].children.map((c) => [c.path, c.urls]), [['/templates/collections', 400], ['/templates/category', 200]]);
  assert.equal(s.sections.find((x) => x.path === '/blog').updated_90d, null, 'no dates means null, not zero');
  const other = s.sections.at(-1);
  assert.equal(other.path, 'other');
  assert.equal(other.urls, 2);
});

// ---------- sitecheck ----------

const ROBOTS = `User-Agent: *
Allow: /
Disallow: /invite/

User-Agent: AhrefsBot
Disallow: /

User-Agent: Amazonbot
User-Agent: meta-externalagent
Disallow: /

User-agent: GPTBot
Disallow: /private/
`;

test('robots rules resolve per bot, including grouped user-agents', () => {
  const g = parseRobots(ROBOTS);
  assert.deepEqual(botAccess(g, 'Amazonbot'), { access: 'blocked', explicit: true });
  assert.deepEqual(botAccess(g, 'meta-externalagent'), { access: 'blocked', explicit: true });
  assert.deepEqual(botAccess(g, 'GPTBot'), { access: 'partly', explicit: true });
  assert.deepEqual(botAccess(g, 'ClaudeBot'), { access: 'partly', explicit: false }, 'falls back to * which disallows /invite/');
  assert.equal(botAccess(g, 'AhrefsBot').access, 'blocked');
});

test('head facts read title, description, canonical, hreflang and JSON-LD types', () => {
  const html = `<html><head><title>Acme</title><meta name="description" content="Do things"><link rel="canonical" href="https://acme.com/">
    <link rel="alternate" hreflang="fr" href="/fr"><script type="application/ld+json">{"@graph":[{"@type":"Organization"},{"@type":["WebSite"]}]}</script></head>
    <body><h1>Hi</h1>${'word '.repeat(200)}</body></html>`;
  const h = headFacts(html);
  assert.equal(h.title, 'Acme');
  assert.equal(h.description, 'Do things');
  assert.equal(h.canonical, 'https://acme.com/');
  assert.equal(h.hreflang, 1);
  assert.deepEqual(h.jsonld_types, ['Organization', 'WebSite']);
  assert.ok(h.text_chars > 500);
});

test('a failed fetch is "unknown", never "no"', () => {
  const rows = toChecks({ robots: null, llms: null, head: null });
  assert.ok(rows.length >= 3);
  for (const r of rows) assert.equal(r.result, 'unknown', `${r.check} should be unknown`);
});

test('llms.txt served as an HTML page does not count as published', () => {
  const rows = toChecks({ robots: { groups: parseRobots(ROBOTS), sitemaps: 1 }, llms: { ok: false, lines: 1 }, head: null });
  assert.equal(rows.find((r) => r.check === 'llms.txt').result, 'no');
});

// ---------- techstack ----------

test('classifies third-party hosts and globals, ignores first-party hosts', () => {
  const r = classify({
    hosts: { 'www.acme.com': 50, 'exp.acme.com': 1, 'connect.facebook.net': 1, 'cdn.segment.com': 2, 'weird-cdn.example': 1 },
    globals: ['lintrk', 'Statsig'],
  }, 'acme.com');
  const tools = Object.fromEntries(r.tools.map((t) => [t.tool, t.category]));
  assert.equal(tools['Meta Pixel'], 'Advertising pixels');
  assert.equal(tools['LinkedIn Insight Tag'], 'Advertising pixels');
  assert.equal(tools.Segment, 'Analytics');
  assert.equal(tools.Statsig, 'Experimentation');
  assert.deepEqual(r.unknown_hosts, ['weird-cdn.example']);
  assert.equal(r.notes.length, 0, 'pixels were seen, so no caveat');
});

test('no pixels plus a consent manager gives the consent caveat, not "they do not advertise"', () => {
  const r = classify({ hosts: ['transcend-cdn.com'], globals: ['dataLayer'] }, 'acme.com');
  assert.match(r.notes[0], /consent manager is present/);
  assert.match(r.notes[1], /data layer exists but no tag manager/);
});

// ---------- merge ----------
import { merge } from '../scripts/merge.mjs';

test('merge assigns stable ids by layer and rewrites every evidence_ref', () => {
  const run = { domain: 'a.com', captured_at: '2026-10-20T00:00:00Z', sources: { firecrawl: 'connected' } };
  const social = { layer: 'social', items: [{ ref: 's1', channel: 'social', status: 'observed', finding: 'x', url: 'https://x.com/a' }],
    posts: [{ platform: 'x', account: 'a', url: 'https://x.com/a/1', published: '2026-10-01', evidence_ref: 's1' }],
    community: { discord: { members: 5, evidence_ref: 's1' } } };
  const paid = { layer: 'paid', items: [{ ref: 'p1', channel: 'google_ads', status: 'observed', finding: 'y', url: 'https://g.com' }],
    ads: [{ platform: 'google', days_shown: 3, url: 'https://g.com/1' }] };
  const { evidence, ids } = merge(run, [social, paid]);
  assert.deepEqual(ids, { p1: 'E001', s1: 'E002' }, 'paid comes before social regardless of file order');
  assert.equal(evidence.posts[0].evidence_id, 'E002');
  assert.equal(evidence.community.discord.evidence_id, 'E002');
  assert.equal(evidence.ads[0].id, 'AD001');
  assert.ok(!('ref' in evidence.items[0]) && !('evidence_ref' in evidence.posts[0]));
});

test('merge refuses a dangling evidence_ref or duplicate ref', () => {
  const run = { domain: 'a.com', captured_at: '2026-10-20T00:00:00Z' };
  assert.throws(() => merge(run, [{ layer: 'owned', items: [], site: { sections: [], evidence_ref: 'nope' } }]), /does not match any item ref/);
  const dup = { layer: 'owned', items: [{ ref: 'a', channel: 'seo_content', status: 'observed', finding: 'f', url: 'https://a.com' }, { ref: 'a', channel: 'seo_content', status: 'observed', finding: 'g', url: 'https://a.com' }] };
  assert.throws(() => merge(run, [dup]), /duplicate ref "a"/);
});

// ---------- page types, in-sitemap locales, tech input ----------
import { classifyPages, findLocalePrefixesFromPages } from '../scripts/sitemap.mjs';
import { extractSeen } from '../scripts/techstack.mjs';

test('comparison pages are found by slug anywhere in the path, not only under /vs or /alternatives', () => {
  const pages = [
    'https://a.com/f/hubspot-crm-alternatives', 'https://a.com/f/crm-vs-spreadsheet', 'https://a.com/compare/zoho',
    'https://a.com/blog/notion-vs-airtable', 'https://a.com/changelog/2024/time-comparison-reporting', 'https://a.com/help/compare-reports',
    'https://a.com/pricing', 'https://a.com/blog/versioning-your-api',
  ].map((loc) => ({ loc, lastmod: null }));
  const t = classifyPages(pages, { asOf: '2026-10-20' });
  assert.equal(t.comparison.urls, 4, 'two /f/ pages, /compare/ and a blog "vs" post count; changelog/help feature names do not');
  assert.ok(!t.comparison.examples.some((u) => /changelog|help/.test(u)));
});

test('translations inside a single sitemap are detected from their un-prefixed twins', () => {
  const base = ['p/one', 'p/two', 'p/three', 'p/four'].map((x) => ({ loc: `https://a.com/${x}`, lastmod: null }));
  const de = ['p/one', 'p/two', 'p/three'].map((x) => ({ loc: `https://a.com/de/${x}`, lastmod: null }));
  const real = [{ loc: 'https://a.com/md/teams' }, { loc: 'https://a.com/md/sales' }, { loc: 'https://a.com/md/ops' }];
  assert.deepEqual(findLocalePrefixesFromPages([...base, ...de, ...real]), ['de'], '/md/ has no un-prefixed twins, so it is a real section');
  assert.deepEqual(findLocalePrefixesFromPages([...base, ...de.slice(0, 2)]), [], 'two copies is not enough evidence');
});

test('tech input may be the parsed object, a JSON string, or the whole Firecrawl scrape result', () => {
  const seen = { hosts: { 'a.com': 3 }, scriptHosts: ['connect.facebook.net'], globals: ['fbq'] };
  assert.deepEqual(extractSeen(seen), seen);
  assert.deepEqual(extractSeen(JSON.stringify(seen)), seen);
  const scrape = { actions: { javascriptReturns: [{ type: 'string', value: JSON.stringify(seen) }] }, rawHtml: '<html>' };
  assert.deepEqual(extractSeen(scrape), seen);
  assert.throws(() => extractSeen({ foo: 1 }), /expected an object with "hosts"/);
});

test('merge refuses an item with no finding and an unknown fragment key', () => {
  const run = { domain: 'a.com', captured_at: '2026-10-20T00:00:00Z' };
  assert.throws(() => merge(run, [{ layer: 'owned', items: [{ ref: 'x', channel: 'comparison', status: 'observed', absent: true, probe: 'p', url: 'https://a.com' }] }]), /"finding" is required/);
  assert.throws(() => merge(run, [{ layer: 'company', items: [], martech_unknown_hosts: [] }]), /unknown key "martech_unknown_hosts"/);
});
