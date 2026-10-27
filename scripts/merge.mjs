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
//   "content": { "items": [{ "title", "url", "kind"?, "date"?, "author"? }], "evidence_ref" }   (blog posts, guides and other owned content that is not a comparison or customer story)
//   "earned":  { "items": [{ "title", "url", "kind", "outlet"?, "date"?, "upcoming"? }], "evidence_ref" }   (press, podcasts, events, webinars)
//   "ratings": { "items": [{ "source", "rating", "count"?, "scale"?, "url" }], "evidence_ref" }   (review-site ratings)
//   "screens": [{ "kind", "page_url", "image", "caption", "evidence_ref" }]   (page screenshots)
//   "site" | "site_checks" | "tech" | "pricing": { ..., "evidence_ref" }
// }

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './ismain.mjs';
import { normalizeMetrics } from './social.mjs';
import { prepare } from './render.mjs';
import { verifyProvenance } from './verify.mjs';
import { loadCalls } from './lib/calls.mjs';

const LAYER_ORDER = ['paid', 'owned', 'social', 'company'];
const SINGLE = ['site', 'site_checks', 'tech', 'pricing', 'oss', 'traffic', 'meta_ads', 'content', 'earned', 'ratings'];

const FRAGMENT_KEYS = new Set(['layer', 'auto', 'credits', 'items', 'ads', 'ads_total', 'posts', 'accounts', 'oss', 'community', 'site', 'site_checks', 'tech', 'pricing', 'screens', 'traffic', 'meta_ads', 'content', 'earned', 'ratings']);

// previousIds: ref -> id from an earlier merge of the same run, so re-merging after a fix keeps every id that
// analysis.json already cites.
// opts.strict: hand-written posts and ads without a raw_ref are set aside. mergeDir turns it on only when tool calls were
// actually captured, so a hook that did not fire never wipes a report.
export function merge(run, fragments, previousIds = {}, opts = {}) {
  for (const f of fragments) {
    for (const k of Object.keys(f)) {
      if (!FRAGMENT_KEYS.has(k)) throw new Error(`fragment ${f.layer ?? '?'}: unknown key "${k}" (allowed: ${[...FRAGMENT_KEYS].join(', ')}). Put extra detail in an item's finding.`);
    }
  }
  // Machine-made fragments (auto: true, from scripts/extract.mjs) come first within a layer and win over hand-written ones.
  const sorted = [...fragments].sort((a, b) => LAYER_ORDER.indexOf(a.layer) - LAYER_ORDER.indexOf(b.layer) || (b.auto ? 1 : 0) - (a.auto ? 1 : 0));
  const anyAuto = fragments.some((f) => f.auto === true);
  const dropped = [];
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
  const autoPostUrls = new Set(); const autoAccounts = new Set();
  for (const f of sorted) {
    const manual = anyAuto && !f.auto;
    const strictManual = Boolean(opts.strict) && !f.auto;
    // With capture active, a hand-written post or ad must point at a saved response (raw_ref) or it is left out:
    // the report shows what the tools returned, not what a model remembers of it.
    const keep = (kind, list) => (list ?? []).filter((x) => {
      if (!strictManual) return true;
      if (!x.raw_ref) { dropped.push({ layer: f.layer, kind, ref: x.url ?? x.id ?? '?', why: 'hand-written, with no raw_ref to a saved tool response' }); return false; }
      if (kind === 'post' && autoPostUrls.has(x.url)) { dropped.push({ layer: f.layer, kind, ref: x.url, why: 'already extracted from the saved response' }); return false; }
      return true;
    });
    for (const a of keep('ad', f.ads)) out.ads.push({ ...a, id: a.id ?? `AD${String(out.ads.length + 1).padStart(3, '0')}` });
    if (f.ads_total && !(manual && out.ads_total)) out.ads_total = f.ads_total;
    keep('post', f.posts).forEach((p, i) => {
      if (f.auto) autoPostUrls.add(p.url);
      out.posts.push({ id: p.id ?? `P${String(out.posts.length + 1).padStart(3, '0')}`, ...resolveRef({ ...p, metrics: normalizeMetrics(p.platform, p.metrics) }, `${f.layer}.posts[${i}]`) });
    });
    (f.screens ?? []).forEach((x, i) => out.screens.push({ id: x.id ?? `S${String(out.screens.length + 1).padStart(2, '0')}`, ...resolveRef(x, `${f.layer}.screens[${i}]`) }));
    (f.accounts ?? []).forEach((a, i) => {
      const k = `${a.platform}:${String(a.handle).toLowerCase()}`;
      if (f.auto) autoAccounts.add(k);
      else if (anyAuto && autoAccounts.has(k)) { dropped.push({ layer: f.layer, kind: 'account', ref: a.handle, why: 'already built from the saved data' }); return; }
      out.accounts.push(resolveRef(a, `${f.layer}.accounts[${i}]`));
    });
    for (const k of SINGLE) {
      if (!f[k]) continue;
      if (owner[k]) {
        const prev = out[k]?.raw_ref ? 'auto' : null;
        if (f.auto || manual) {
          // one side is machine-made: it wins, the other is set aside
          if (f.auto) { out[k] = resolveRef(f[k], `${f.layer}.${k}`); owner[k] = f.layer; }
          dropped.push({ layer: f.auto ? owner[k] : f.layer, kind: k, ref: k, why: 'replaced by the block built from saved data' });
          void prev;
          continue;
        }
        throw new Error(`"${k}" is written by both the ${owner[k]} and ${f.layer} layers; only one layer may write it`);
      }
      owner[k] = f.layer;
      out[k] = resolveRef(f[k], `${f.layer}.${k}`);
    }
    if (f.community) {
      out.community = { ...(out.community ?? {}) };
      for (const [k, v] of Object.entries(f.community)) { if (manual && out.community[k]?.raw_ref) { dropped.push({ layer: f.layer, kind: `community.${k}`, ref: k, why: 'replaced by the block built from saved data' }); continue; } out.community[k] = resolveRef(v, `${f.layer}.community.${k}`); }
    }
  }
  if (anyAuto) out.provenance = { capture_active: Boolean(opts.strict), auto_layers: sorted.filter((f) => f.auto).map((f) => f.layer), dropped };
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
  const captured = loadCalls(dir).length;
  const { evidence, ids } = merge(run, fragments, previous, { strict: captured > 0 });
  // Every machine-made entry must match the saved tool response it points at.
  const prov = verifyProvenance(dir, evidence);
  if (prov.errors.length) throw new Error(`provenance check failed:\n  - ${prov.errors.join('\n  - ')}`);
  if (evidence.provenance) evidence.provenance = { ...evidence.provenance, verified: prov.counts.verified, warnings: prov.warnings };
  // Check the evidence now, not at render time: a bad url, channel or absence fails before analysis.
  prepare(evidence, {});
  writeFileSync(join(dir, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  writeFileSync(join(dir, 'evidence-ids.json'), `${JSON.stringify(ids, null, 2)}\n`);
  return { items: evidence.items.length, fragments: files.length, ...(evidence.provenance ? { provenance: evidence.provenance } : {}) };
}

if (isMain(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node scripts/merge.mjs <reports/domain>'); process.exit(2); }
  try {
    const r = mergeDir(dir);
    console.log(`merged ${r.fragments} fragments into ${join(dir, 'evidence.json')} (${r.items} evidence items)`);
    const p = r.provenance;
    if (p) {
      console.log(`provenance: ${p.verified.posts} posts, ${p.verified.ads} ads and ${p.verified.blocks} blocks verified against saved tool responses; ${p.dropped.length} hand-written entr${p.dropped.length === 1 ? 'y' : 'ies'} set aside`);
      for (const d of p.dropped) console.log(`  set aside (${d.layer} ${d.kind}): ${d.ref} - ${d.why}`);
      for (const w of p.warnings) console.log(`  warning: ${w}`);
    }
  } catch (e) { console.error(`error: ${e.message}`); process.exit(1); }
}
