#!/usr/bin/env node
// Merge collector fragments into one evidence.json.
//
//   node scripts/merge.mjs reports/<domain>
//
// Reads reports/<domain>/run.json (domain, captured_at, sources, cost) and every
// reports/<domain>/fragments/*.json written by the collectors. Each fragment uses its own
// local reference keys ("ref") so collectors never coordinate on ids; this script assigns
// E001, E002 ... and keeps them stable across re-merges (evidence-ids.json) and rewrites every "evidence_ref" to the final id.
//
// Fragment shape (every key optional except items):
// {
//   "layer": "paid" | "owned" | "social" | "company",
//   "items":   [{ "ref": "paid-ads-total", "channel", "status", "finding", "url", ...item fields }],
//   "ads":     [{ ...ad, "id"? }],
//   "ads_total": { "low", "high" },
//   "posts":   [{ ...post, "evidence_ref": "social-x-company" }],
//   "accounts":[{ ...account, "evidence_ref" }],
//   "oss":     { ...oss, "evidence_ref" },
//   "community": { "discord": { ..., "evidence_ref" }, "hacker_news": { ..., "evidence_ref" } },
//   "traffic": { "metric": "visits", "label", "points": [{ "month": "YYYY-MM", "value" }], "source", "source_url", "last_updated"?, "evidence_ref" }   (monthly site visits, Similarweb)
//   "meta_ads": { "source", "advertiser": {id,name}, "active_ads"?, "as_of"?, "spend"?, "creative_mix"?, "ads": [{ id, media_type, is_active, started_at, one_line, hook_text, impressions?, url, thumbnail_url? }], "evidence_ref" }   (Meta ads via Upspring)
//   "screens": [{ "kind", "page_url", "image", "caption", "evidence_ref" }]   (page screenshots)
//   "site" | "site_checks" | "tech" | "pricing": { ..., "evidence_ref" }
// }

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './ismain.mjs';
import { normalizeMetrics } from './social.mjs';
import { prepare } from './render.mjs';

const LAYER_ORDER = ['paid', 'owned', 'social', 'company'];
const SINGLE = ['site', 'site_checks', 'tech', 'pricing', 'oss', 'traffic', 'meta_ads'];

const FRAGMENT_KEYS = new Set(['layer', 'credits', 'items', 'ads', 'ads_total', 'posts', 'accounts', 'oss', 'community', 'site', 'site_checks', 'tech', 'pricing', 'screens', 'traffic', 'meta_ads']);

// previousIds: ref -> id from an earlier merge of the same run, so re-merging after a fix keeps every id that
// analysis.json and scores.json already cite.
export function merge(run, fragments, previousIds = {}) {
  for (const f of fragments) {
    for (const k of Object.keys(f)) {
      if (!FRAGMENT_KEYS.has(k)) throw new Error(`fragment ${f.layer ?? '?'}: unknown key "${k}" (allowed: ${[...FRAGMENT_KEYS].join(', ')}). Put extra detail in an item's finding.`);
    }
  }
  const sorted = [...fragments].sort((a, b) => LAYER_ORDER.indexOf(a.layer) - LAYER_ORDER.indexOf(b.layer));
  const idOf = new Map();
  const items = [];
  const taken = new Set(Object.values(previousIds));
  let next = 1;
  const freshId = () => { let id; do { id = `E${String(next++).padStart(3, '0')}`; } while (taken.has(id)); taken.add(id); return id; };
  for (const f of sorted) {
    for (const it of f.items ?? []) {
      if (!it.ref) throw new Error(`fragment ${f.layer}: an item is missing "ref"`);
      if (idOf.has(it.ref)) throw new Error(`duplicate ref "${it.ref}"`);
      if (!it.finding || typeof it.finding !== 'string') throw new Error(`item "${it.ref}": "finding" is required (a checked absence still needs a sentence saying what was checked)`);
      if (!it.channel || !it.status || !it.url) throw new Error(`item "${it.ref}": needs channel, status and url`);
      const id = previousIds[it.ref] ?? freshId();
      idOf.set(it.ref, id);
      const { ref, ...rest } = it;
      items.push({ id, collector: f.layer, captured_at: run.captured_at, ...rest });
    }
  }
  const resolveRef = (obj, where) => {
    if (!obj) return obj;
    const { evidence_ref, ...rest } = obj;
    if (evidence_ref == null) return obj;
    const id = idOf.get(evidence_ref);
    if (!id) throw new Error(`${where}: evidence_ref "${evidence_ref}" does not match any item ref`);
    return { ...rest, evidence_id: id };
  };

  const out = {
    domain: run.domain,
    captured_at: run.captured_at,
    ...(run.brand ? { brand: run.brand } : {}),
    ...(run.note ? { note: run.note } : {}),
    sources: run.sources ?? {},
    cost: { ...(run.cost ?? {}), firecrawl_credits: fragments.reduce((n, f) => n + (Number.isFinite(f.credits) ? f.credits : 0), 0) },
    items,
    ads: [],
    posts: [],
    accounts: [],
    screens: [],
  };
  const owner = {};
  for (const f of sorted) {
    for (const a of f.ads ?? []) out.ads.push({ ...a, id: a.id ?? `AD${String(out.ads.length + 1).padStart(3, '0')}` });
    if (f.ads_total) out.ads_total = f.ads_total;
    (f.posts ?? []).forEach((p, i) => out.posts.push({ id: p.id ?? `P${String(out.posts.length + 1).padStart(3, '0')}`, ...resolveRef({ ...p, metrics: normalizeMetrics(p.platform, p.metrics) }, `${f.layer}.posts[${i}]`) }));
    (f.screens ?? []).forEach((x, i) => out.screens.push({ id: x.id ?? `S${String(out.screens.length + 1).padStart(2, '0')}`, ...resolveRef(x, `${f.layer}.screens[${i}]`) }));
    (f.accounts ?? []).forEach((a, i) => out.accounts.push(resolveRef(a, `${f.layer}.accounts[${i}]`)));
    for (const k of SINGLE) {
      if (!f[k]) continue;
      if (owner[k]) throw new Error(`"${k}" is written by both the ${owner[k]} and ${f.layer} layers; only one layer may write it`);
      owner[k] = f.layer;
      out[k] = resolveRef(f[k], `${f.layer}.${k}`);
    }
    if (f.community) {
      out.community = { ...(out.community ?? {}) };
      for (const [k, v] of Object.entries(f.community)) out.community[k] = resolveRef(v, `${f.layer}.community.${k}`);
    }
  }
  return { evidence: out, ids: Object.fromEntries(idOf) };
}

export function mergeDir(dir) {
  const runPath = join(dir, 'run.json');
  if (!existsSync(runPath)) throw new Error(`missing ${runPath}`);
  const run = JSON.parse(readFileSync(runPath, 'utf8'));
  const fdir = join(dir, 'fragments');
  const files = existsSync(fdir) ? readdirSync(fdir).filter((f) => f.endsWith('.json')).sort() : [];
  const fragments = files.map((f) => {
    try { return JSON.parse(readFileSync(join(fdir, f), 'utf8')); }
    catch (e) { throw new Error(`${f} is not valid JSON: ${e.message}`); }
  });
  const idsPath = join(dir, 'evidence-ids.json');
  const previous = existsSync(idsPath) ? JSON.parse(readFileSync(idsPath, 'utf8')) : {};
  const { evidence, ids } = merge(run, fragments, previous);
  // Check the evidence now, not at render time: a bad url, channel or absence fails before scoring and analysis.
  prepare(evidence, {});
  writeFileSync(join(dir, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  writeFileSync(join(dir, 'evidence-ids.json'), `${JSON.stringify(ids, null, 2)}\n`);
  return { items: evidence.items.length, fragments: files.length };
}

if (isMain(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node scripts/merge.mjs <reports/domain>'); process.exit(2); }
  try {
    const r = mergeDir(dir);
    console.log(`merged ${r.fragments} fragments into ${join(dir, 'evidence.json')} (${r.items} evidence items)`);
  } catch (e) { console.error(`error: ${e.message}`); process.exit(1); }
}
