#!/usr/bin/env node
// Build the machine-made part of the evidence ledger from what the tools actually returned.
//
//   node scripts/extract.mjs reports/<domain>            write fragments/<layer>.auto.json and extract-report.json
//   node scripts/extract.mjs reports/<domain> --inspect  show the shape of every captured call (for new providers)
//
// Inputs: raw/calls/*.json (every Firecrawl and Exa response, saved verbatim by scripts/capture.mjs) and the raw/*.json
// from the free scripts. Output fragments carry "auto": true; every post, ad and block has a raw_ref back to its source.
// The model's only inputs are judgments (judgments/<layer>.json: who owns an account, what kind a post is).

import { readFileSync, writeFileSync, readdirSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { isMain } from './ismain.mjs';
import { loadCalls, alexandria, findRecords } from './lib/calls.mjs';
import { extractXPosts } from './extract/xposts.mjs';
import { extractLinkedInPosts } from './extract/exa.mjs';
import { extractGoogleAds } from './extract/googleads.mjs';
import { extractPricing } from './extract/pricing.mjs';
import { extractScripts } from './extract/scripts.mjs';

const readJson = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };

// judgments/<layer>.json: { "owners": { "<handle>": "company|founder|employee" }, "kinds": { "<post url>": "launch" } }
export function loadJudgments(dir) {
  const jdir = join(dir, 'judgments');
  const out = { owners: {}, kinds: {} };
  if (!existsSync(jdir)) return out;
  for (const f of readdirSync(jdir).filter((x) => x.endsWith('.json')).sort()) {
    const j = readJson(join(jdir, f), {});
    for (const [h, o] of Object.entries(j.owners ?? {})) if (['company', 'founder', 'employee'].includes(o)) out.owners[h.toLowerCase()] = o;
    for (const [u, k] of Object.entries(j.kinds ?? {})) if (typeof k === 'string') out.kinds[u] = k;
  }
  return out;
}

export function makeContext(dir) {
  const run = readJson(join(dir, 'run.json'), {});
  const social = readJson(join(dir, 'raw', 'social.json'), {});
  const j = loadJudgments(dir);
  const own = new Set((social.accounts ?? []).map((a) => `${a.platform}:${String(a.handle).replace(/^company\//, '').toLowerCase()}`));
  const defaulted = new Set();
  // Posts older than this many days before the capture are not shown as recent posts (run.json "post_window_days").
  const days = Number.isFinite(run.post_window_days) ? run.post_window_days : 120;
  const at = Date.parse(run.captured_at ?? '') || Date.now();
  return {
    cutoff: new Date(at - days * 864e5).toISOString().slice(0, 10), windowDays: days,
    domain: run.domain ?? social.domain, brand: run.brand,
    ownerOf(handle, platform) {
      const h = String(handle).toLowerCase();
      if (j.owners[h]) return j.owners[h];
      if (own.has(`${platform}:${h}`)) return 'company';
      defaulted.add(`${platform}:${handle}`);
      return 'employee';
    },
    kindOf: (url) => j.kinds[url],
    defaulted,
  };
}

function combine(parts) {
  const by = new Map();
  for (const p of parts) {
    if (!p) continue;
    const f = by.get(p.layer) ?? { layer: p.layer, auto: true, credits: 0, items: [] };
    for (const [k, v] of Object.entries(p)) {
      if (['layer', 'skipped', 'outside', 'unmapped'].includes(k)) continue;
      if (Array.isArray(v)) f[k] = [...(f[k] ?? []), ...v];
      else if (k === 'community') f.community = { ...(f.community ?? {}), ...v };
      else f[k] = v;
    }
    by.set(p.layer, f);
  }
  return [...by.values()].filter((f) => Object.keys(f).some((k) => !['layer', 'auto', 'credits'].includes(k) && (!Array.isArray(f[k]) || f[k].length)));
}

export function extractAll(dir) {
  const calls = loadCalls(dir);
  const ctx = makeContext(dir);
  const x = extractXPosts(calls, ctx); const li = extractLinkedInPosts(calls, ctx); const ga = extractGoogleAds(calls, ctx); const pr = extractPricing(calls);
  const sc = extractScripts(dir, ctx);
  // The same handle can come from the homepage links and from posts: keep the post-derived one (it may carry followers).
  const seenAcct = new Set((x.accounts ?? []).map((a) => `${a.platform}:${a.handle.toLowerCase()}`));
  for (const f of sc) if (f.accounts) f.accounts = f.accounts.filter((a) => !seenAcct.has(`${a.platform}:${String(a.handle).toLowerCase()}`));
  const fragments = combine([x, li, ga, pr, ...sc]);
  const skipped = [...x.skipped, ...li.skipped, ...ga.skipped, ...(pr.skipped ?? [])];
  const report = {
    calls: calls.length,
    tools: Object.fromEntries([...new Set(calls.map((c) => c.short))].map((t) => [t, calls.filter((c) => c.short === t).length])),
    extracted: {
      x_posts: x.posts.length, linkedin_posts: li.posts.length, google_ads: ga.ads.length, pricing_plans: pr.pricing?.plans.length ?? 0,
      script_blocks: sc.flatMap((f) => Object.keys(f).filter((k) => ['site', 'site_checks', 'oss', 'community', 'accounts'].includes(k))),
    },
    skipped,
    outside_window: { days: ctx.windowDays, since: ctx.cutoff, posts: [...x.outside, ...li.outside] },
    unmapped_fields: Object.fromEntries(Object.entries({ x_posts: x.unmapped, google_ads: ga.unmapped }).filter(([, v]) => v?.length)),
    owners_defaulted_to_team: [...ctx.defaulted],
  };
  return { fragments, report };
}

// A short description of each captured call, to see what a provider really returns before writing a mapping.
export function inspect(dir) {
  return loadCalls(dir).map((c) => {
    const alx = alexandria(c).map((a) => { const f = findRecords(a.result); return { provider: a.provider, capability: a.capability, records: f?.records.length ?? 0, ptr: f?.ptr, first_record_keys: f?.records[0] ? Object.keys(f.records[0]) : [], result_keys: Object.keys(a.result ?? {}) }; });
    return { file: c.file, tool: c.short, args: c.args, response_is_json: c.json !== undefined, top_level_keys: c.json && typeof c.json === 'object' ? Object.keys(c.json) : null, text_chars: c.text.length, alexandria: alx };
  });
}

export function writeAuto(dir) {
  const fdir = join(dir, 'fragments');
  mkdirSync(fdir, { recursive: true });
  for (const f of readdirSync(fdir).filter((x) => x.endsWith('.auto.json'))) rmSync(join(fdir, f));
  const { fragments, report } = extractAll(dir);
  for (const f of fragments) writeFileSync(join(fdir, `${f.layer}.auto.json`), `${JSON.stringify(f, null, 2)}\n`);
  writeFileSync(join(dir, 'extract-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (isMain(import.meta.url)) {
  const [dir, flag] = process.argv.slice(2);
  if (!dir) { console.error('usage: node scripts/extract.mjs <reports/domain> [--inspect]'); process.exit(2); }
  try {
    if (flag === '--inspect') console.log(JSON.stringify(inspect(dir), null, 2));
    else {
      const r = writeAuto(dir);
      console.log(`extracted from ${r.calls} captured call${r.calls === 1 ? '' : 's'}: ${r.extracted.x_posts} X posts, ${r.extracted.linkedin_posts} LinkedIn posts, ${r.extracted.google_ads} Google ads, ${r.extracted.pricing_plans} pricing plans; ${r.skipped.length} record${r.skipped.length === 1 ? '' : 's'} skipped (see ${join(dir, 'extract-report.json')})`);
      if (r.outside_window.posts.length) console.log(`note: ${r.outside_window.posts.length} post${r.outside_window.posts.length === 1 ? '' : 's'} older than ${r.outside_window.days} days were left out of the recent posts (listed in extract-report.json).`);
      for (const [k, v] of Object.entries(r.unmapped_fields)) console.log(`warning: ${k}: the provider sent fields no mapping reads: ${v.join(', ')}. Run --inspect; a count or date may be missing from the report.`);
      if (r.calls === 0) console.log('warning: no calls were captured. The capture hook may not be active; posts and ads will not be verbatim.');
      if (r.owners_defaulted_to_team.length) console.log(`note: no owner given for ${r.owners_defaulted_to_team.join(', ')}; shown as team accounts until judgments/<layer>.json says otherwise.`);
    }
  } catch (e) { console.error(`error: ${e.message}`); process.exit(1); }
}
