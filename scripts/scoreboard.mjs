// The score-led parts of the report: the hero's growth-play cards, the "what you can take" list and the
// activity sections (one block per rubric activity, with its score, read and sources).
// Pure functions: scores + analysis in, HTML out. Everything is rendered on the server, so the page reads
// without scripts and prints in full.
//
// Honesty rules kept here:
//   * "Not covered" is never drawn as 0. Only a checked absence is a 0, and it says so.
//   * low confidence (under LOW_CONFIDENCE) is written in words next to the score.
//   * every finding shown carries its source link; reads without evidence were dropped before this point.

import { ACTIVITIES } from './rubric.mjs';
import { esc, short } from './util.mjs';

export const LOW_CONFIDENCE = 0.5;
export const STRONG_FROM = 70;
export const STEADY_FROM = 40;
export const TOP_PLAYS = 6;
// The report's sections, in reading order. Each holds one or more rubric activities.
export const SECTIONS = [
  { id: 'organic', label: 'Organic social', activities: ['organic_social', 'founder_social', 'video'] },
  { id: 'seo', label: 'SEO and AEO', activities: ['aeo', 'seo_content'] },
  { id: 'owned', label: 'Owned content', activities: ['comparison', 'customer_proof'] },
  { id: 'earned', label: 'Earned content', activities: ['press', 'events'] },
  { id: 'paid-social', label: 'Paid social', activities: ['paid_social'] },
  { id: 'paid-search', label: 'Paid search', activities: ['google_ads'] },
  { id: 'conversion', label: 'Signup and pricing', activities: ['signup_entry', 'pricing'] },
  { id: 'community', label: 'Community and open source', activities: ['community', 'open_source'] },
  { id: 'partners', label: 'Partnerships and referral', activities: ['partnerships', 'referral'] },
];

// One row per rubric activity: scored (high to low), checked and not found, then not covered.
export function scoreRows(scores) {
  const acts = scores?.activities ?? {};
  const rows = ACTIVITIES.map((a) => {
    const s = acts[a.id];
    // A model score of 0 with no evidence behind it is not a finding: show it as not covered.
    const scored = s && Number.isFinite(s.score) && !['not_covered', 'no_answer'].includes(s.basis) && !(s.score === 0 && s.basis !== 'checked_absence' && !(s.evidence_ids ?? []).length);
    return {
      id: a.id, label: a.label, group: a.group, question: a.question,
      score: scored ? Math.round(s.score) : null,
      confidence: Number.isFinite(s?.confidence) ? s.confidence : null,
      basis: s?.basis ?? 'not_covered',
      state: !scored ? 'uncovered' : s.basis === 'checked_absence' ? 'absent' : 'scored',
      evidence_ids: s?.evidence_ids ?? [],
    };
  });
  const rank = { scored: 0, absent: 1, uncovered: 2 };
  rows.sort((x, y) => rank[x.state] - rank[y.state] || (y.score ?? 0) - (x.score ?? 0) || (y.confidence ?? 0) - (x.confidence ?? 0) || x.label.localeCompare(y.label));
  return rows;
}

export const isLow = (r) => r.confidence != null && r.confidence < LOW_CONFIDENCE;
const band = (r) => (r.state !== 'scored' ? 'n' : r.score >= STRONG_FROM ? 'g' : r.score >= STEADY_FROM ? 'a' : 'n');

// ---------- hero: the brand, then the strongest growth plays as cards ----------

// Which activities to feature. Judgement first: the analyst's picks, then the takeaways' activities, then the
// highest scores that are not plain hygiene, at most two per section so the cards are not all one kind.
const HYGIENE = new Set(['aeo', 'pricing', 'seo_content']);
export function pickPlays(scores, an, n = TOP_PLAYS) {
  const rows = scoreRows(scores).filter((r) => r.state === 'scored');
  const byId = new Map(rows.map((r) => [r.id, r]));
  const chosen = [];
  const add = (id) => { const r = byId.get(id); if (r && !chosen.includes(r)) chosen.push(r); };
  // The analyst's choice is final: no padding with other activities.
  if (an.plays?.length) { for (const p of an.plays) add(p.activity); return chosen.slice(0, n); }
  for (const t of an.takeaways ?? []) add(t.activity);
  const secOf = (id) => SECTIONS.find((x) => x.activities.includes(id))?.id;
  const perSection = (id) => chosen.filter((r) => secOf(r.id) === secOf(id)).length;
  for (const r of rows) {
    if (chosen.length >= n) break;
    if (HYGIENE.has(r.id) || isLow(r) || perSection(r.id) >= 2) continue;
    add(r.id);
  }
  for (const r of rows) { if (chosen.length >= n) break; if (r.score >= STEADY_FROM) add(r.id); }
  return chosen.slice(0, n);
}

export function renderPlays(scores, an) {
  const top = pickPlays(scores, an);
  if (!top.length) return '';
  const cards = top.map((r) => {
    const read = an.reads.get(r.id);
    return `<a class="gplay" href="#a-${esc(r.id)}"><span class="ptop"><span class="pname">${esc(r.label)}</span><span class="pscore s-${band(r)}">${r.score}</span></span>${isLow(r) ? '<span class="plow">Low confidence</span>' : ''}<span class="pread">${read ? esc(read.read) : esc(r.question)}</span><span class="pgo">See details</span></a>`;
  }).join('');
  return `<div class="plays">${cards}</div>`;
}

// ---------- takeaways: what you can borrow ----------

export function renderTake({ an, scores, ctx }) {
  if (!an.takeaways.length) return '';
  const steps = an.takeaways.map((t, i) => `<li class="take"><span class="tn">${i + 1}</span><div class="tb">
      <h3>${esc(t.move)}</h3>
      ${ctx.claim(t.observed, t.evidence_ids, { cls: 'tobs' })}
      <a class="btn" href="#a-${esc(t.activity)}">See details</a>
    </div></li>`).join('');
  return `<section id="take" class="block" aria-labelledby="take-h"><h2 id="take-h">What you can take from this</h2><ol class="takes">${steps}</ol></section>`;
}

// ---------- the sections: each holds its activities, one after another ----------

// The evidence behind a block, as plain links: where to go to check it.
function sourceLinks(row, read, prep, ctx) {
  const ids = [...new Set([...(read?.evidence_ids ?? []), ...row.evidence_ids])].filter((id) => prep.byId.has(id));
  const seen = new Set();
  const links = [];
  for (const id of ids) {
    const it = prep.byId.get(id);
    if (seen.has(it.url)) continue;
    seen.add(it.url);
    let label;
    try { const u = new URL(it.url); label = `${u.hostname.replace(/^www\./, '')}${u.pathname.length > 1 ? u.pathname.replace(/\/$/, '').slice(0, 28) : ''}`; } catch { label = it.url; }
    links.push(`<a class="schip" href="${esc(it.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(`Source for: ${short(it.finding)}`)}">${esc(label)}<span aria-hidden="true"> ↗</span></a>`);
    if (links.length >= 4) break;
  }
  const probe = row.state === 'absent' ? ids.map((id) => prep.byId.get(id).probe).find(Boolean) : '';
  return `${probe ? `<p class="facts muted">Checked: ${esc(probe)}</p>` : ''}${links.length ? `<p class="srcline"><span class="slab">Sources</span>${links.join('')}</p>` : ''}`;
}

function activityBlock(row, read, prep, ctx, proof) {
  if (row.state === 'uncovered') {
    return `<article class="act un" id="a-${esc(row.id)}">
    <header class="aside"><h3>${esc(row.label)}</h3><span class="ascore word">Not covered</span><span class="abar dashed" aria-hidden="true"></span></header>
    <div class="abody"><p class="aread muted">We could not look at this in this run, so it has no score.</p></div></article>`;
  }
  const b = row.state === 'absent' ? 'n' : band(row);
  const score = row.state === 'absent' ? 0 : row.score;
  const p = proof(row.id);
  const sub = row.state === 'absent' ? 'Checked, none found' : row.score === 0 ? 'Nothing found in what we collected' : isLow(row) ? 'Low confidence' : '';
  return `<article class="act" id="a-${esc(row.id)}">
    <header class="aside"><h3>${esc(row.label)}</h3><span class="ascore s-${b}">${score}<small>/100</small></span><span class="abar" aria-hidden="true"><i class="b-${b}" style="width:${score}%"></i></span>${sub ? `<p class="asub">${esc(sub)}</p>` : ''}<p class="asub">${row.evidence_ids.length} ${row.evidence_ids.length === 1 ? 'finding' : 'findings'} behind this score</p></header>
    <div class="abody">
      <p class="aread">${read ? esc(read.read) : row.state === 'absent' ? 'We checked and found nothing.' : esc(row.question)}</p>
      ${p.note ? `<p class="note-s">${esc(p.note)}</p>` : ''}
      ${p.facts ?? ''}
      ${p.inline ? `<div class="inl">${p.inline}</div>` : ''}
      ${p.strip ?? ''}
      ${sourceLinks(row, read, prep, ctx)}
    </div>
  </article>`;
}

export function renderSections({ scores, an, prep, ctx, proof, intro = {} }) {
  const byId = new Map(scoreRows(scores).map((r) => [r.id, r]));
  return SECTIONS.map((sec) => {
    const rows = sec.activities.map((id) => byId.get(id)).filter(Boolean);
    if (!rows.length) return '';
    return `<section id="s-${esc(sec.id)}" class="block card" aria-labelledby="s-${esc(sec.id)}-h"><h2 id="s-${esc(sec.id)}-h">${esc(sec.label)}</h2>
      ${intro[sec.id] ?? ''}
      ${rows.map((r) => activityBlock(r, an.reads.get(r.id), prep, ctx, proof)).join('')}</section>`;
  }).filter(Boolean).join('\n');
}

export const uncoveredActivities = (scores) => scoreRows(scores).filter((r) => r.state === 'uncovered');
