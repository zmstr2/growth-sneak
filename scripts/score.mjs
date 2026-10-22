#!/usr/bin/env node
// Score every growth activity with Jev (TypeSafe), one number per activity.
//
//   TYPESAFE_API_KEY=... node scripts/score.mjs reports/<domain>
//
// Reads evidence.json, writes scores.json. With no key it writes nothing and says so: the analyst scores
// the same rubric instead (see agents/sneak-analyst.md). The key is only ever read from the environment.
//
// What goes to the model is the evidence we collected for each activity, as short lines with their ids.
// "Couldn't see" is decided here, in code, before any call: an activity with no evidence is not scored, and
// an activity whose only evidence is a checked absence is a plain 0. The model never has to guess either.

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './ismain.mjs';
import { ACTIVITIES, toPercent, nearestLevel } from './rubric.mjs';
import { engagementOf, hasMetrics } from './social.mjs';

export const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const MODEL = 'jev-latest';

const isFact = (i) => ['observed', 'stated'].includes(i.status) && !i.absent;
const short = (s, n = 420) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

// The evidence lines for one activity. Each line starts with the evidence id so the analyst can cite it.
export function digestFor(activity, ev) {
  const lines = [];
  const items = ev.items.filter((i) => activity.channels.includes(i.channel));
  for (const i of items.filter(isFact)) lines.push(`${i.id}: ${short(i.finding)}`);
  // Lines built from structured blocks carry the id of the evidence item behind the block, so every score cites
  // something. A count of zero is never sent as evidence: zero pages in a sitemap is not a checked absence.
  const extra = [];
  const extraIds = new Set();
  const cite = (id, text) => { if (!id) return; extra.push(`${id}: ${text}`); extraIds.add(id); };
  const posts = (ev.posts ?? []);
  const eng = (list) => list.filter(hasMetrics).map(engagementOf).sort((a, b) => b - a).slice(0, 8);
  const postLine = (list, who) => {
    if (!list.length) return;
    const dates = list.map((p) => p.published).sort();
    const e = eng(list);
    cite(list[0].evidence_id, `${list.length} ${who} posts seen, dated ${dates.at(0)} to ${dates.at(-1)}; ${e.length ? `engagement per post (likes, comments and reposts added up): ${e.join(', ')}` : 'engagement not visible'}.`);
  };
  if (activity.id === 'organic_social') postLine(posts.filter((p) => p.owner === 'company' && !p.reply), 'company');
  if (activity.id === 'founder_social') {
    postLine(posts.filter((p) => p.owner === 'founder' && !p.reply), 'founder');
    for (const a of (ev.accounts ?? []).filter((x) => x.owner === 'founder' && x.followers > 0)) cite(a.evidence_id, `${a.handle}: ${a.followers} followers.`);
  }
  if (activity.id === 'google_ads') {
    const own = (ev.ads ?? []).filter((x) => x.own !== false);
    const adItem = items.find(isFact);
    if (own.length && adItem) cite(adItem.id, `${own.length} of the company's own ads collected; days shown: ${own.map((x) => x.days_shown).sort((x, y) => y - x).slice(0, 12).join(', ')}.`);
  }
  if (activity.id === 'seo_content' && ev.site?.total_urls) {
    const secs = (ev.site.sections ?? []).slice(0, 6).map((x) => `${x.path} ${x.urls} pages${x.updated_90d != null ? ` (${x.updated_90d} updated in 90 days)` : ''}`);
    cite(ev.site.evidence_id, `Site: ${ev.site.total_urls} English pages. Sections: ${secs.join('; ')}.`);
    if (ev.site.by_month?.length) cite(ev.site.evidence_id, `Pages last updated per month: ${ev.site.by_month.map((m) => `${m.month} ${m.pages}`).join(', ')}.`);
  }
  if (activity.id === 'comparison' && ev.site?.page_types?.comparison?.urls > 0) {
    const c = ev.site.page_types.comparison; cite(ev.site.evidence_id, `${c.urls} comparison-type URLs in the sitemap${c.updated_90d != null ? `, ${c.updated_90d} updated in 90 days` : ''}.`);
  }
  if (activity.id === 'customer_proof' && ev.site?.page_types?.customers?.urls > 0) {
    cite(ev.site.evidence_id, `${ev.site.page_types.customers.urls} customer story URLs in the sitemap.`);
  }
  if (activity.id === 'community' && ev.community) {
    const hn = ev.community.hacker_news, d = ev.community.discord;
    if (d?.members > 0) cite(d.evidence_id, `Discord: ${d.members} members.`);
    if (hn?.stories > 0) cite(hn.evidence_id, `Hacker News: ${hn.stories} stories link to the site.`);
  }
  if (activity.id === 'open_source' && ev.oss?.repos > 0) {
    cite(ev.oss.evidence_id, `GitHub org: ${ev.oss.repos} repos${Number.isFinite(ev.oss.stars) ? `, ${ev.oss.stars} stars in total` : ''}. Top repos: ${(ev.oss.top ?? []).slice(0, 4).map((r) => `${r.name} ${r.stars ?? '?'} stars, last pushed ${r.pushed ?? '?'}`).join('; ')}.`);
  }
  if ((activity.id === 'pricing' || activity.id === 'signup_entry') && ev.pricing?.plans?.length) {
    cite(ev.pricing.evidence_id, `Plans: ${ev.pricing.plans.map((p) => `${p.name} (${p.price}${p.cta ? `, button "${p.cta}"` : ''})`).join('; ')}.`);
  }
  if (activity.id === 'aeo' && ev.site_checks?.checks?.length) {
    cite(ev.site_checks.evidence_id, `Site checks: ${ev.site_checks.checks.map((c) => `${c.check}: ${c.result}`).join('; ')}.`);
  }
  if (activity.id === 'partnerships' && ev.site?.page_types?.integrations?.urls > 0) cite(ev.site.evidence_id, `${ev.site.page_types.integrations.urls} integration pages in the sitemap.`);
  const absent = items.filter((i) => i.absent);
  const unchecked = items.filter((i) => i.status === 'couldnt_check');
  return { lines: [...lines, ...extra], absent, unchecked, ids: [...new Set([...items.filter(isFact).map((i) => i.id), ...extraIds])] };
}

// Decide, per activity, whether to ask the model.
export function plan(ev) {
  const asked = {}, decided = {};
  for (const a of ACTIVITIES) {
    const d = digestFor(a, ev);
    if (d.lines.length) asked[a.id] = d;
    else if (d.absent.length) decided[a.id] = { score: 0, level: 0, confidence: null, basis: 'checked_absence', evidence_ids: d.absent.map((i) => i.id), note: d.absent[0].probe };
    else decided[a.id] = { score: null, level: null, confidence: null, basis: 'not_covered', evidence_ids: d.unchecked.map((i) => i.id) };
  }
  return { asked, decided };
}

export function buildRequest(ev, asked) {
  const ids = Object.keys(asked);
  return {
    model: MODEL,
    state: {
      company: ev.brand ?? ev.domain, domain: ev.domain, captured: String(ev.captured_at).slice(0, 10),
      evidence: Object.fromEntries(ids.map((id) => [id, asked[id].lines])),
    },
    questions: Object.fromEntries(ids.map((id) => {
      const a = ACTIVITIES.find((x) => x.id === id);
      return [id, { type: 'score', instructions: `${a.question} Use only the lines under evidence.${id}. Score what is visible there; do not assume anything that was not collected.`, criteria: a.levels }];
    })),
  };
}

export async function callJev(request, { key, fetchImpl = fetch, retries = 2 } = {}) {
  let last;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetchImpl(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(request), signal: AbortSignal.timeout(60_000) });
      if (res.status === 429 || res.status >= 500) { last = new Error(`HTTP ${res.status}`); await new Promise((r) => setTimeout(r, 1500 * (i + 1))); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${short(await res.text(), 300)}`);
      return await res.json();
    } catch (e) { last = e; if (i === retries) break; await new Promise((r) => setTimeout(r, 1000)); }
  }
  throw last ?? new Error('request failed');
}

export function collect(ev, { asked, decided }, response) {
  const out = { ...decided };
  for (const [id, d] of Object.entries(asked)) {
    const ans = response.answers?.[id];
    if (!ans || ans.type !== 'score') { out[id] = { score: null, level: null, confidence: null, basis: 'no_answer', evidence_ids: d.ids }; continue; }
    out[id] = { score: toPercent(ans.score), level: nearestLevel(ans.score), raw: ans.score, confidence: ans.confidence, probabilities: ans.probabilities, basis: 'jev', evidence_ids: d.ids };
  }
  return out;
}

export async function scoreEvidence(ev, { key, fetchImpl } = {}) {
  const p = plan(ev);
  const request = buildRequest(ev, p.asked);
  const response = Object.keys(p.asked).length ? await callJev(request, { key, fetchImpl }) : { answers: {}, usage: {}, model: null };
  return { model: response.model, scored_at: new Date().toISOString(), usage: response.usage, activities: collect(ev, p, response) };
}

// No key: the analyst gives each activity a level (0 to 3) on the same rubric. Same shape, no confidence.
export function fallbackScores(analysis, ev) {
  const p = plan(ev);
  const out = { ...p.decided };
  for (const row of analysis.activity_levels ?? []) {
    if (!p.asked[row.activity]) continue;
    const level = Math.max(0, Math.min(3, Math.round(Number(row.level))));
    out[row.activity] = { score: toPercent(level), level, confidence: null, basis: 'analyst', evidence_ids: row.evidence_ids ?? p.asked[row.activity].ids };
  }
  for (const id of Object.keys(p.asked)) if (!out[id]) out[id] = { score: null, level: null, confidence: null, basis: 'no_answer', evidence_ids: p.asked[id].ids };
  return { model: null, scored_at: new Date().toISOString(), usage: null, activities: out };
}

// Levels written before the current evidence.json belong to an older run.
export const analysisIsStale = (analysisPath, evidencePath) => statSync(analysisPath).mtimeMs < statSync(evidencePath).mtimeMs;

async function main() {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: TYPESAFE_API_KEY=... node scripts/score.mjs <reports/domain>'); process.exit(2); }
  const evPath = join(dir, 'evidence.json');
  if (!existsSync(evPath)) { console.error(`error: missing ${evPath}`); process.exit(1); }
  const key = process.env.TYPESAFE_API_KEY;
  const ev = JSON.parse(readFileSync(evPath, 'utf8'));
  if (!key) {
    // No key: once the analyst has written `activity_levels`, turn them into scores.json (run this script again).
    const aPath = join(dir, 'analysis.json');
    const analysis = existsSync(aPath) ? JSON.parse(readFileSync(aPath, 'utf8')) : null;
    // Levels written before this evidence.json are from an older run: never turn them into scores.
    const stale = analysis && analysisIsStale(aPath, evPath);
    if (stale) { console.log('No TYPESAFE_API_KEY set, and analysis.json is older than evidence.json: run the analyst first, then run this script again.'); return; }
    if (analysis?.activity_levels?.length) {
      const result = fallbackScores(analysis, ev);
      writeFileSync(join(dir, 'scores.json'), `${JSON.stringify(result, null, 2)}\n`);
      const n = Object.values(result.activities).filter((a) => a.score != null).length;
      console.log(`No TYPESAFE_API_KEY set: wrote ${n} analyst-scored activities (levels, no confidence) -> ${join(dir, 'scores.json')}`);
    } else {
      console.log('No TYPESAFE_API_KEY set: skipping Jev scoring. The analyst will give each activity a level on the same rubric; then run this script again to write scores.json.');
    }
    return;
  }
  const result = await scoreEvidence(ev, { key });
  writeFileSync(join(dir, 'scores.json'), `${JSON.stringify(result, null, 2)}\n`);
  const n = Object.values(result.activities).filter((a) => a.score != null).length;
  console.log(`scored ${n} of ${ACTIVITIES.length} activities (${result.usage?.input_tokens ?? '?'} input tokens) -> ${join(dir, 'scores.json')}`);
}

if (isMain(import.meta.url)) {
  main().catch((e) => { console.error(`error: ${String(e.message).replace(/Bearer\s+\S+/gi, 'Bearer ***')}`); process.exit(1); });
}
