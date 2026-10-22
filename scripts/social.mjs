#!/usr/bin/env node
// Social and community signals.
//
//   node scripts/social.mjs exa.ai > social.json
//
// Free and first-party where possible:
//   * accounts: discovered from the company's own homepage links and JSON-LD "sameAs"
//   * GitHub: public REST API (org repos and stars)
//   * Discord: public invite endpoint (member and online counts)
//   * Hacker News: Algolia's public search API (stories linking to the domain)
// Posts from X and LinkedIn come from MCP providers (Firecrawl's x-com provider, Exa search,
// or the user's own Apify key) and are normalised by the collector into POST_SHAPE below.
//
// The pure helpers (discovery, engagement, account stats) are what the renderer relies on.

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36';

/**
 * POST_SHAPE (what collectors write into evidence.json "posts"):
 * { id, platform: 'x'|'linkedin'|'youtube'|'reddit'|'hn'|'instagram'|'tiktok', account, owner: 'company'|'founder'|'employee',
 *   url, published: 'YYYY-MM-DD', text, kind?: 'launch'|'partnership'|'event'|'research'|'hiring'|'stunt'|'milestone'|'other',
 *   metrics: { likes?, reposts?, replies?, reactions?, comments?, views?, points? }, paid?: boolean, evidence_id }
 */

// ---------- account discovery (pure) ----------

const PLATFORMS = [
  ['x', /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/(?!intent|share|home|search|i\/)([A-Za-z0-9_]{1,15})\/?(?:[?#].*)?$/i],
  ['linkedin', /^https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(company|in|showcase)\/([^/?#]+)\/?(?:[?#].*)?$/i],
  ['youtube', /^https?:\/\/(?:www\.)?youtube\.com\/(@[^/?#]+|c\/[^/?#]+|channel\/[^/?#]+|user\/[^/?#]+)\/?(?:[?#].*)?$/i],
  ['github', /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9-]+)\/?(?:[?#].*)?$/i],
  ['discord', /^https?:\/\/(?:www\.)?(?:discord\.gg|discord\.com\/invite)\/([A-Za-z0-9-]+)\/?$/i],
  ['reddit', /^https?:\/\/(?:www\.)?reddit\.com\/(r|user|u)\/([^/?#]+)\/?$/i],
  ['instagram', /^https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9_.]+)\/?(?:[?#].*)?$/i],
  ['tiktok', /^https?:\/\/(?:www\.)?tiktok\.com\/@([A-Za-z0-9_.]+)\/?(?:[?#].*)?$/i],
];

export function discoverAccounts(html) {
  const s = String(html);
  const urls = new Set();
  for (const m of s.matchAll(/href=["'](https?:\/\/[^"'<> ]+)["']/gi)) urls.add(m[1].replace(/&amp;/g, '&'));
  for (const m of s.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { collectSameAs(JSON.parse(m[1]), urls); } catch { /* ignore bad JSON-LD */ }
  }
  const found = new Map();
  for (const u of urls) {
    for (const [platform, re] of PLATFORMS) {
      const m = u.match(re);
      if (!m) continue;
      const handle = platform === 'linkedin' || platform === 'reddit' ? `${m[1]}/${m[2]}` : m[1];
      const key = `${platform}:${handle.toLowerCase()}`;
      if (!found.has(key)) found.set(key, { platform, handle, url: u.split(/[?#]/)[0] });
    }
  }
  return [...found.values()].sort((a, b) => a.platform.localeCompare(b.platform) || a.handle.localeCompare(b.handle));
}

function collectSameAs(node, out) {
  if (Array.isArray(node)) { node.forEach((n) => collectSameAs(n, out)); return; }
  if (!node || typeof node !== 'object') return;
  for (const v of [].concat(node.sameAs ?? [])) if (typeof v === 'string') out.add(v);
  if (node['@graph']) collectSameAs(node['@graph'], out);
}

// ---------- metrics: one vocabulary per platform ----------

// Collectors get numbers from different sources with different names. LinkedIn counts are reactions and comments,
// so a LinkedIn "likes" is a reaction and a "replies" is a comment. Keys a platform does not have are dropped.
const METRIC_KEYS = {
  x: ['likes', 'reposts', 'replies', 'views'],
  linkedin: ['reactions', 'comments', 'reposts'],
  instagram: ['likes', 'comments', 'views'],
  tiktok: ['views', 'likes', 'comments', 'shares'],
  youtube: ['views', 'likes', 'comments'],
  hn: ['points', 'comments'],
  reddit: ['points', 'comments'],
};
const ALIASES = { linkedin: { likes: 'reactions', replies: 'comments', shares: 'reposts' }, hn: { likes: 'points' }, reddit: { likes: 'points', upvotes: 'points' }, x: { retweets: 'reposts', comments: 'replies' } };
export function normalizeMetrics(platform, metrics) {
  if (!metrics || typeof metrics !== 'object') return metrics;
  const keys = METRIC_KEYS[platform];
  const alias = ALIASES[platform] ?? {};
  const out = {};
  for (const [k0, v] of Object.entries(metrics)) {
    if (!Number.isFinite(v)) continue;
    const k = alias[k0] ?? k0;
    if (keys && !keys.includes(k)) continue;
    out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

// ---------- engagement and account stats (pure) ----------

// One number per post so posts on the same platform are comparable.
export function engagementOf(post) {
  const m = post.metrics ?? {};
  switch (post.platform) {
    case 'x': return (m.likes ?? 0) + (m.reposts ?? 0) + (m.replies ?? 0);
    case 'linkedin': return (m.reactions ?? 0) + (m.comments ?? 0);
    case 'hn': return (m.points ?? 0) + (m.comments ?? 0);
    case 'reddit': return (m.points ?? m.likes ?? 0) + (m.comments ?? 0);
    case 'youtube': return m.views ?? 0;
    case 'tiktok': return (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0);
    case 'instagram': return (m.likes ?? 0) + (m.comments ?? 0);
    default: return (m.likes ?? 0) + (m.comments ?? m.replies ?? 0) + (m.reposts ?? 0) + (m.reactions ?? 0);
  }
}

// A post with no readable numbers has unknown engagement, which is not the same as zero.
export const hasMetrics = (post) => Object.values(post.metrics ?? {}).some((v) => Number.isFinite(v));

export const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};

export const MIN_POSTS_FOR_BASELINE = 5;
export const OUTLIER_RATIO = 2;
// A post is only an outlier if it also clears an absolute floor: 37 likes on an account whose usual post
// gets 5 is noise, not a signal a reader should chase.
export const MIN_OUTLIER_ENGAGEMENT = 50;

// Per account: how often they post, their usual engagement, and which posts beat it.
export function accountStats(posts, { asOf, windowDays = 90 } = {}) {
  const groups = new Map();
  for (const p of posts) {
    const key = `${p.platform}:${p.account}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const asOfMs = asOf ? Date.parse(asOf) : null;
  return [...groups.entries()].map(([key, list]) => {
    const [platform, account] = key.split(/:(.*)/s);
    const measured = list.filter(hasMetrics);
    const eng = measured.map(engagementOf);
    const base = median(eng);
    const dates = list.map((p) => Date.parse(p.published)).filter(Number.isFinite).sort((a, b) => a - b);
    const spanDays = dates.length > 1 ? Math.max(1, (dates.at(-1) - dates[0]) / 86_400_000) : null;
    const inWindow = asOfMs ? list.filter((p) => asOfMs - Date.parse(p.published) <= windowDays * 86_400_000).length : list.length;
    const enough = measured.length >= MIN_POSTS_FOR_BASELINE && base > 0;
    const scored = measured.map((p) => ({ ...p, engagement: engagementOf(p), ratio: enough ? engagementOf(p) / base : null }))
      .sort((a, b) => b.engagement - a.engagement);
    return {
      platform,
      account,
      owner: list[0].owner,
      sampled: list.length,
      measured: measured.length,
      in_window: inWindow,
      per_week: spanDays ? Math.round((list.length / spanDays) * 7 * 10) / 10 : null,
      median_engagement: base,
      baseline_ok: enough,
      top: scored.slice(0, 3),
      outliers: enough ? scored.filter((p) => p.ratio >= OUTLIER_RATIO && p.engagement >= MIN_OUTLIER_ENGAGEMENT) : [],
    };
  }).sort((a, b) => (b.median_engagement ?? 0) - (a.median_engagement ?? 0));
}

// ---------- network (free public endpoints) ----------

async function getJson(url) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return await res.json();
  } catch (e) { return { error: String(e.message) }; }
}

export async function github(org) {
  const r = await getJson(`https://api.github.com/orgs/${encodeURIComponent(org)}/repos?per_page=100&sort=updated`);
  const list = Array.isArray(r) ? r : (await getJson(`https://api.github.com/users/${encodeURIComponent(org)}/repos?per_page=100&sort=updated`));
  if (!Array.isArray(list)) return { org, error: list.error ?? 'not found' };
  const own = list.filter((x) => !x.fork);
  return {
    org,
    repos: own.length,
    stars: own.reduce((n, x) => n + x.stargazers_count, 0),
    top: own.sort((a, b) => b.stargazers_count - a.stargazers_count).slice(0, 8)
      .map((x) => ({ name: x.name, url: x.html_url, stars: x.stargazers_count, pushed: x.pushed_at?.slice(0, 10), description: x.description ?? '' })),
  };
}

export async function discord(invite) {
  const r = await getJson(`https://discord.com/api/v9/invites/${encodeURIComponent(invite)}?with_counts=true`);
  if (r.error || !r.guild) return { invite, error: r.error ?? 'not found' };
  return { invite, name: r.guild.name, members: r.approximate_member_count, online: r.approximate_presence_count };
}

export async function hackerNews(domain) {
  const r = await getJson(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(domain)}&restrictSearchableAttributes=url&hitsPerPage=50`);
  if (r.error) return { domain, error: r.error };
  return {
    domain,
    stories: r.nbHits,
    top: r.hits.sort((a, b) => b.points - a.points).slice(0, 8).map((h) => ({
      title: h.title, url: h.url, hn_url: `https://news.ycombinator.com/item?id=${h.objectID}`,
      points: h.points, comments: h.num_comments, published: h.created_at.slice(0, 10),
    })),
  };
}

export async function run(domain) {
  const host = `https://${String(domain).replace(/^https?:\/\//, '').replace(/\/.*$/, '')}/`;
  let html = '';
  try { html = await (await fetch(host, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20_000) })).text(); } catch { /* unknown */ }
  const accounts = html ? discoverAccounts(html) : null;
  const gh = accounts?.find((a) => a.platform === 'github');
  const dc = accounts?.find((a) => a.platform === 'discord');
  const [g, d, hn] = await Promise.all([gh ? github(gh.handle) : null, dc ? discord(dc.handle) : null, hackerNews(domain)]);
  return { domain, homepage: host, accounts, github: g, discord: d, hacker_news: hn };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const domain = process.argv[2];
  if (!domain) { console.error('usage: node scripts/social.mjs <domain>'); process.exit(2); }
  run(domain).then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => { console.error(`error: ${e.message}`); process.exit(1); });
}
