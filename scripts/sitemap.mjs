#!/usr/bin/env node
// Site breakdown from the company's own sitemaps: free, first-party and exact.
//
//   node scripts/sitemap.mjs notion.com [--as-of 2026-10-20] > sitemap.json
//
// Reads robots.txt "Sitemap:" lines (falls back to /sitemap.xml), expands sitemap indexes,
// skips translated copies (a locale prefix like /es/ or /pt-br/ that repeats across several
// sitemaps), then groups page URLs into sections by their first path segment.

import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const UA = 'Mozilla/5.0 (compatible; GrowthSneak/0.12; public sitemap reader)';
const MAX_SITEMAPS = 80;
const MAX_URLS = 500_000;
const MAX_BYTES = 60 * 1024 * 1024;
const MIN_SECTION = 5; // smaller top-level paths are folded into "Other pages"
const CHILD_MIN = 500; // sections this big also get a second-level breakdown
const DAY = 86_400_000;

// ---------- pure helpers (tested) ----------

export function parseSitemapXml(xml) {
  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  const entries = [];
  const re = /<(url|sitemap)>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const loc = m[2].match(/<loc>\s*([^<\s]+)\s*<\/loc>/i)?.[1];
    if (!loc) continue;
    const lastmod = m[2].match(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/i)?.[1] ?? null;
    entries.push({ loc: decodeXml(loc), lastmod });
  }
  return { isIndex, entries };
}

const decodeXml = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");

export function robotsSitemaps(robotsTxt) {
  return [...String(robotsTxt).matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]);
}

const LOCALE_PREFIX = /^\/([a-z]{2}(?:-[a-z]{2,4})?)(\/.*)$/i;

// A prefix counts as a locale only if it repeats: at least 3 sitemaps whose un-prefixed twin also exists.
// That keeps real two-letter sections (Notion's /md/) from being mistaken for languages.
export function findLocalePrefixes(sitemapUrls) {
  const byKey = new Set(sitemapUrls.map((u) => keyOf(u)));
  const hits = new Map();
  for (const u of sitemapUrls) {
    const { host, path } = splitUrl(u);
    const m = path.match(LOCALE_PREFIX);
    if (!m) continue;
    if (byKey.has(`${host}${m[2]}`)) hits.set(m[1].toLowerCase(), (hits.get(m[1].toLowerCase()) ?? 0) + 1);
  }
  return [...hits].filter(([, n]) => n >= 3).map(([p]) => p).sort();
}

function splitUrl(u) {
  try { const x = new URL(u); return { host: x.hostname.replace(/^www\./, ''), path: x.pathname }; } catch { return { host: '', path: '' }; }
}
const keyOf = (u) => { const { host, path } = splitUrl(u); return `${host}${path}`; };

export function isLocaleCopy(url, locales) {
  const m = splitUrl(url).path.match(LOCALE_PREFIX);
  return Boolean(m && locales.includes(m[1].toLowerCase()));
}

// Page families found by slug, anywhere in the path (so /f/hubspot-crm-alternatives counts as a comparison
// page even though it is not under /alternatives). Counted over every page, before grouping.
// Paths where these words describe a product feature, not a competitor ("time comparison reporting").
const NOT_COMPARISON = /^\/(changelog|releases|help|docs|support|academy|legal|careers|jobs)(\/|$)/i;
export const PAGE_TYPES = [
  ['comparison', (path) => !NOT_COMPARISON.test(path) && /(^|[/-])(vs|versus|compare|comparison|comparisons|alternative|alternatives|competitors?)([/-]|$)/i.test(path)],
  ['landing', /^\/(lp|landing|go)\//i],
  ['integrations', /^\/(integrations?|connections|apps|marketplace)(\/|$)/i],
  ['customers', /^\/(customers?|case-studies|stories)(\/|$)/i],
  ['templates', /^\/templates?(\/|$)/i],
  ['jobs', /^\/(careers|jobs)\/.+/i],
  ['webinars', /^\/(webinars?|events?)(\/|$)/i],
  ['docs_help', /^\/(docs|help|support|academy)(\/|$)/i],
];

export function classifyPages(pages, { asOf } = {}) {
  const asOfMs = Date.parse(asOf);
  const recent = (lm) => lm && Number.isFinite(Date.parse(lm)) && asOfMs - Date.parse(lm) <= 90 * DAY && Date.parse(lm) <= asOfMs + DAY;
  const out = {};
  for (const [name] of PAGE_TYPES) out[name] = { urls: 0, updated_90d: 0, dated: 0, examples: [] };
  const seen = new Set();
  for (const p of pages) {
    if (seen.has(p.loc)) continue;
    seen.add(p.loc);
    const path = splitUrl(p.loc).path;
    for (const [name, re] of PAGE_TYPES) {
      if (!(typeof re === 'function' ? re(path) : re.test(path))) continue;
      const t = out[name];
      t.urls++;
      if (p.lastmod) t.dated++;
      if (recent(p.lastmod)) t.updated_90d++;
      if (t.examples.length < 12) t.examples.push(p.loc);
    }
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { urls: v.urls, updated_90d: v.dated ? v.updated_90d : null, examples: v.examples }]));
}

// Translated copies that live inside one sitemap (so the sitemap-level check can't see them): a prefix
// counts as a locale when at least 3 of its pages have an un-prefixed twin among the pages.
export function findLocalePrefixesFromPages(pages) {
  const keys = new Set(pages.map((p) => keyOf(p.loc)));
  const hits = new Map();
  for (const p of pages) {
    const { host, path } = splitUrl(p.loc);
    const m = path.match(LOCALE_PREFIX);
    if (!m) continue;
    if (keys.has(`${host}${m[2]}`)) hits.set(m[1].toLowerCase(), (hits.get(m[1].toLowerCase()) ?? 0) + 1);
  }
  return [...hits].filter(([, n]) => n >= 3).map(([p]) => p).sort();
}

// How many pages were last updated in each of the last `months` months (oldest first). A sitemap's
// lastmod is the last edit, so older months undercount: pages edited again move to a later month.
export function updatesByMonth(pages, { asOf, months = 12 } = {}) {
  const end = new Date(asOf);
  if (Number.isNaN(end.getTime())) return [];
  const keys = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  const counts = new Map(keys.map((k) => [k, 0]));
  const seen = new Set();
  for (const p of pages) {
    if (!p.lastmod || seen.has(p.loc)) continue;
    seen.add(p.loc);
    const k = String(p.lastmod).slice(0, 7);
    if (counts.has(k)) counts.set(k, counts.get(k) + 1);
  }
  return keys.map((month) => ({ month, pages: counts.get(month) }));
}

// Group page URLs into sections. `asOf` makes "updated in the last 90 days" deterministic.
export function summarize(pages, { domain, asOf }) {
  const root = String(domain).replace(/^www\./, '');
  const asOfMs = Date.parse(asOf);
  const recent = (lm) => lm && Number.isFinite(Date.parse(lm)) && asOfMs - Date.parse(lm) <= 90 * DAY && Date.parse(lm) <= asOfMs + DAY;
  const groups = new Map();
  const seen = new Set();
  for (const p of pages) {
    if (seen.has(p.loc)) continue;
    seen.add(p.loc);
    const { host, path } = splitUrl(p.loc);
    const onSite = host === root || host.endsWith(`.${root}`);
    const segs = path.split('/').filter(Boolean);
    const key = !onSite ? `${host}` : segs.length ? `/${segs[0]}` : '/';
    if (!groups.has(key)) groups.set(key, { path: key, external: !onSite, urls: 0, updated_90d: 0, dated: 0, examples: [], children: new Map() });
    const g = groups.get(key);
    g.urls++;
    if (p.lastmod) g.dated++;
    if (recent(p.lastmod)) g.updated_90d++;
    if (g.examples.length < 2) g.examples.push(p.loc);
    if (onSite && segs.length > 1) {
      const ck = `/${segs[0]}/${segs[1]}`;
      g.children.set(ck, (g.children.get(ck) ?? 0) + 1);
    }
  }
  const all = [...groups.values()];
  const big = all.filter((g) => g.urls >= MIN_SECTION || g.external);
  const small = all.filter((g) => !(g.urls >= MIN_SECTION || g.external));
  const shape = (g) => ({
    path: g.path,
    urls: g.urls,
    updated_90d: g.dated ? g.updated_90d : null, // null = the sitemap gives no dates for this section
    examples: g.examples,
    children: g.urls >= CHILD_MIN
      ? [...g.children].map(([path, urls]) => ({ path, urls })).filter((c) => c.urls >= MIN_SECTION).sort((a, b) => b.urls - a.urls).slice(0, 4)
      : [],
  });
  const sections = big.map(shape).sort((a, b) => b.urls - a.urls || a.path.localeCompare(b.path));
  if (small.length) {
    sections.push({
      path: 'other',
      urls: small.reduce((n, g) => n + g.urls, 0),
      updated_90d: small.some((g) => g.dated) ? small.reduce((n, g) => n + g.updated_90d, 0) : null,
      examples: small.slice(0, 2).map((g) => g.examples[0]),
      children: [],
      grouped: small.length,
    });
  }
  return { total_urls: seen.size, sections };
}

// ---------- network ----------

async function get(url, { timeoutMs = 20_000 } = {}) {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/xml,text/xml,text/plain,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('too large');
  const gz = url.endsWith('.gz') || (buf[0] === 0x1f && buf[1] === 0x8b);
  return (gz ? gunzipSync(buf) : buf).toString('utf8');
}

export async function crawl(domain, { asOf = new Date().toISOString().slice(0, 10) } = {}) {
  const base = `https://${String(domain).replace(/^https?:\/\//, '').replace(/\/.*$/, '')}`;
  const result = { domain, as_of: asOf, robots_url: `${base}/robots.txt`, sitemaps_read: 0, sitemaps_failed: [], locales: [], capped: false };

  let roots = [];
  try { roots = robotsSitemaps(await get(result.robots_url)); } catch { /* fall back below */ }
  if (!roots.length) roots = [`${base}/sitemap.xml`];
  result.declared = roots;

  // Breadth-first over sitemap indexes. Locale detection needs the full sitemap list, so collect first.
  const queue = [...roots];
  const sitemapUrls = new Set(roots);
  const fetched = new Map();
  while (queue.length && fetched.size < MAX_SITEMAPS) {
    const u = queue.shift();
    let parsed;
    try { parsed = parseSitemapXml(await get(u)); } catch (e) { result.sitemaps_failed.push({ url: u, error: String(e.message) }); continue; }
    fetched.set(u, parsed);
    if (parsed.isIndex) {
      for (const e of parsed.entries) if (!sitemapUrls.has(e.loc)) { sitemapUrls.add(e.loc); queue.push(e.loc); }
    }
    // Skip translated copies as soon as we know which prefixes are locales.
    const locales = findLocalePrefixes([...sitemapUrls]);
    for (let i = queue.length - 1; i >= 0; i--) if (isLocaleCopy(queue[i], locales)) queue.splice(i, 1);
  }
  if (queue.length) result.capped = true;
  result.locales = findLocalePrefixes([...sitemapUrls]);
  result.sitemaps_read = fetched.size;

  const pages = [];
  for (const [u, parsed] of fetched) {
    if (parsed.isIndex || isLocaleCopy(u, result.locales)) continue;
    for (const e of parsed.entries) {
      if (isLocaleCopy(e.loc, result.locales)) continue;
      pages.push(e);
      if (pages.length >= MAX_URLS) { result.capped = true; break; }
    }
  }
  // Second pass: locales inside a single sitemap.
  const inner = findLocalePrefixesFromPages(pages).filter((l) => !result.locales.includes(l));
  const english = inner.length ? pages.filter((p) => !isLocaleCopy(p.loc, inner)) : pages;
  result.locales = [...result.locales, ...inner].sort();
  return { ...result, ...summarize(english, { domain, asOf }), page_types: classifyPages(english, { asOf }), by_month: updatesByMonth(english, { asOf }) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const domain = args.find((a) => !a.startsWith('--'));
  const asOfIdx = args.indexOf('--as-of');
  if (!domain) { console.error('usage: node scripts/sitemap.mjs <domain> [--as-of YYYY-MM-DD]'); process.exit(2); }
  crawl(domain, asOfIdx > -1 ? { asOf: args[asOfIdx + 1] } : {})
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => { console.error(`error: ${e.message}`); process.exit(1); });
}
