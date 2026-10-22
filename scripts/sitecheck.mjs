#!/usr/bin/env node
// Search and AI-search readiness checks from the company's own files: robots.txt, llms.txt
// and the homepage's raw HTML. Free, first-party, and every result is yes / no / unknown.
// "unknown" means we could not check (blocked, timed out), never a guess.
//
//   node scripts/sitecheck.mjs notion.com > sitecheck.json

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36';

export const AI_BOTS = [
  { ua: 'GPTBot', who: 'OpenAI training' },
  { ua: 'OAI-SearchBot', who: 'ChatGPT search' },
  { ua: 'ClaudeBot', who: 'Anthropic' },
  { ua: 'PerplexityBot', who: 'Perplexity' },
  { ua: 'Google-Extended', who: 'Google AI training' },
  { ua: 'Applebot-Extended', who: 'Apple AI training' },
  { ua: 'meta-externalagent', who: 'Meta AI' },
  { ua: 'Amazonbot', who: 'Amazon' },
  { ua: 'CCBot', who: 'Common Crawl' },
];
export const SEO_BOTS = ['AhrefsBot', 'SemrushBot', 'MJ12bot', 'DotBot', 'BLEXBot'];

// ---------- pure helpers (tested) ----------

export function parseRobots(text) {
  const groups = [];
  let cur = null;
  let lastWasAgent = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (field === 'allow' || field === 'disallow') {
      if (cur) cur.rules.push({ type: field, path: value });
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

// "blocked" = disallowed from the whole site; "partly" = some paths disallowed; "allowed" otherwise.
// `explicit` says whether the bot has its own group or falls back to the "*" rules.
export function botAccess(groups, ua) {
  const name = ua.toLowerCase();
  const own = groups.filter((g) => g.agents.some((a) => a !== '*' && (name === a || name.includes(a) || a.includes(name))));
  const use = own.length ? own : groups.filter((g) => g.agents.includes('*'));
  const rules = use.flatMap((g) => g.rules);
  const rootBlocked = rules.some((r) => r.type === 'disallow' && (r.path === '/' || r.path === '/*'));
  const rootAllowed = rules.some((r) => r.type === 'allow' && (r.path === '/' || r.path === '/*'));
  const someBlocked = rules.some((r) => r.type === 'disallow' && r.path);
  const access = rootBlocked && !rootAllowed ? 'blocked' : someBlocked ? 'partly' : 'allowed';
  return { access, explicit: own.length > 0 };
}

export function headFacts(html) {
  const s = String(html);
  const attr = (re) => s.match(re)?.[1]?.trim() ?? null;
  const title = attr(/<title[^>]*>([^<]*)<\/title>/i);
  const description = attr(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)
    ?? attr(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i);
  const canonical = attr(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
  const hreflang = (s.match(/<link[^>]+hreflang=/gi) ?? []).length;
  const types = new Set();
  for (const m of s.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { collectTypes(JSON.parse(m[1]), types); } catch { types.add('(unparseable)'); }
  }
  const text = s.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return { title, description, canonical, hreflang, jsonld_types: [...types].sort(), text_chars: text.length, h1: (s.match(/<h1[\s>]/gi) ?? []).length };
}

function collectTypes(node, out) {
  if (Array.isArray(node)) { node.forEach((n) => collectTypes(n, out)); return; }
  if (!node || typeof node !== 'object') return;
  if (node['@type']) [].concat(node['@type']).forEach((t) => out.add(String(t)));
  if (node['@graph']) collectTypes(node['@graph'], out);
}

// Turn raw facts into the rows the report shows.
export function toChecks({ robots, llms, head }) {
  const rows = [];
  const yes = (check, detail) => rows.push({ check, result: 'yes', detail });
  const no = (check, detail) => rows.push({ check, result: 'no', detail });
  const unknown = (check, detail) => rows.push({ check, result: 'unknown', detail });

  if (robots == null) unknown('robots.txt', 'Could not fetch it');
  else if (robots.missing) no('robots.txt', 'No robots.txt (every crawler is allowed by default)');
  else yes('robots.txt', `${robots.groups.length} rule ${robots.groups.length === 1 ? 'group' : 'groups'}, ${robots.sitemaps} ${robots.sitemaps === 1 ? 'sitemap' : 'sitemaps'} declared`);

  if (llms == null) unknown('llms.txt', 'Could not check');
  else if (llms.ok) yes('llms.txt', `Published (${llms.lines} lines)`);
  else no('llms.txt', 'Not found');

  if (robots) {
    const allowed = []; const blocked = []; const partly = [];
    for (const b of AI_BOTS) {
      const r = botAccess(robots.groups, b.ua);
      (r.access === 'blocked' ? blocked : r.access === 'partly' ? partly : allowed).push(b.ua);
    }
    const seo = SEO_BOTS.filter((b) => botAccess(robots.groups, b).access === 'blocked');
    rows.push({ check: 'AI crawlers allowed', result: allowed.length + partly.length ? 'yes' : 'no', detail: [...allowed, ...partly].join(', ') || 'None' });
    rows.push({ check: 'AI crawlers blocked', result: blocked.length ? 'yes' : 'no', detail: blocked.join(', ') || 'None' });
    rows.push({ check: 'SEO tool crawlers blocked', result: seo.length ? 'yes' : 'no', detail: seo.join(', ') || 'None' });
  }

  if (!head) {
    unknown('Homepage readable without JavaScript', 'Could not fetch the homepage');
  } else {
    const ssr = head.text_chars >= 500;
    (ssr ? yes : no)('Homepage readable without JavaScript', `${head.text_chars.toLocaleString('en-US')} characters of text in the raw HTML`);
    (head.description ? yes : no)('Meta description', head.description ? `“${head.description.length > 70 ? `${head.description.slice(0, 69).trimEnd()}…` : head.description}”` : 'Missing');
    (head.canonical ? yes : no)('Canonical URL', head.canonical ?? 'Missing');
    (head.jsonld_types.length ? yes : no)('Structured data (JSON-LD)', head.jsonld_types.join(', ') || 'None on the homepage');
    (head.hreflang ? yes : no)('Language versions (hreflang)', head.hreflang ? `${head.hreflang} alternates` : 'None');
  }
  return rows;
}

// ---------- network ----------

async function fetchText(url) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(20_000) });
    return { status: res.status, type: res.headers.get('content-type') ?? '', text: await res.text() };
  } catch {
    return null; // network failure = unknown, never "no"
  }
}

export async function run(domain) {
  const base = `https://${String(domain).replace(/^https?:\/\//, '').replace(/\/.*$/, '')}`;
  const [r, l, h] = await Promise.all([fetchText(`${base}/robots.txt`), fetchText(`${base}/llms.txt`), fetchText(`${base}/`)]);

  // 200 = read it. 404 = there is no file (for robots.txt that means every crawler is allowed). Anything else
  // (403, 5xx, a network failure) is unknown, never a yes or a no.
  const robots = r?.status === 200 ? { groups: parseRobots(r.text), sitemaps: (r.text.match(/^\s*sitemap:/gim) ?? []).length, missing: false }
    : r?.status === 404 ? { groups: [], sitemaps: 0, missing: true } : null;
  let llms = null;
  if (l && (l.status === 200 || l.status === 404)) {
    const looksHtml = /html/i.test(l.type) || /^\s*<!doctype html|^\s*<html/i.test(l.text);
    llms = { ok: l.status === 200 && !looksHtml && l.text.trim().length > 0, lines: l.text.split('\n').length };
  }
  const head = h && h.status === 200 ? headFacts(h.text) : null;
  return { domain, urls: { robots: `${base}/robots.txt`, llms: `${base}/llms.txt`, home: `${base}/` }, checks: toChecks({ robots, llms, head }) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const domain = process.argv[2];
  if (!domain) { console.error('usage: node scripts/sitecheck.mjs <domain>'); process.exit(2); }
  run(domain).then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => { console.error(`error: ${e.message}`); process.exit(1); });
}
