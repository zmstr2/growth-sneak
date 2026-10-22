// The parts of the report built around the growth activities: the activity sections (one block per activity, with what we saw, the real posts, ads and pages, and
// the sources). Pure functions: coverage + analysis in, HTML out. Everything is rendered on the server, so the
// page reads without scripts and prints in full. Nothing is scored.
//
// Honesty rules kept here:
//   * "Not covered" (we could not look) is never shown as "none found". Only a checked absence says so.
//   * every finding shown carries its source link; reads without evidence were dropped before this point.

import { ACTIVITIES } from './activities.mjs';
import { esc, short } from './util.mjs';

// The report's sections, in reading order. Each holds one or more activities.
export const SECTIONS = [
  { id: 'organic', label: 'Organic social', activities: ['organic_social', 'founder_social', 'video'] },
  { id: 'seo', label: 'SEO and AEO', activities: ['aeo', 'seo_content'] },
  { id: 'owned', label: 'Owned content', activities: ['owned_content', 'comparison', 'customer_proof'] },
  { id: 'earned', label: 'Earned content', activities: ['press', 'events'] },
  { id: 'paid-social', label: 'Paid social', activities: ['paid_social'] },
  { id: 'paid-search', label: 'Paid search', activities: ['google_ads'] },
  { id: 'conversion', label: 'Signup and pricing', activities: ['signup_entry', 'pricing'] },
  { id: 'community', label: 'Community and open source', activities: ['community', 'open_source'] },
  { id: 'partners', label: 'Partnerships and referral', activities: ['partnerships', 'referral'] },
];

// One row per activity, in the fixed order of ACTIVITIES: { id, label, state, evidence_ids }.
export function activityRows(cov) {
  const acts = cov?.activities ?? {};
  return ACTIVITIES.map((a) => ({ id: a.id, label: a.label, state: acts[a.id]?.state ?? 'uncovered', evidence_ids: acts[a.id]?.evidence_ids ?? [], probe: acts[a.id]?.probe }));
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

function activityBlock(row, read, prep, ctx, proof, { single = false } = {}) {
  // Not covered: one quiet line, so a gap does not take up a whole panel.
  if (row.state === 'uncovered') {
    return `<article class="act un" id="a-${esc(row.id)}">
    <header class="ahead"><h3>${esc(row.label)}</h3><span class="state state-none">Not covered</span></header>
    <p class="aread muted">We could not look at this in this run.</p></article>`;
  }
  const p = proof(row.id);
  const state = row.state === 'absent' ? '<span class="state state-absent">Checked, none found</span>' : '';
  // A block whose examples link to the originals needs no list of sources; the others keep one.
  const sources = p.linked && row.state !== 'absent' ? '' : sourceLinks(row, read, prep, ctx);
  const title = single ? '' : `<h3>${esc(row.label)}</h3>`;
  const head = title || state ? `<header class="ahead">${title}${state}</header>` : '';
  return `<article class="act${single ? ' solo' : ''}" id="a-${esc(row.id)}">
    ${head}
    <p class="aread">${read ? esc(read.read) : row.state === 'absent' ? 'We checked and found nothing.' : 'The sources are below.'}</p>
    ${p.note ? `<p class="note-s">${esc(p.note)}</p>` : ''}
    ${p.facts ?? ''}
    ${p.inline ? `<div class="inl">${p.inline}</div>` : ''}
    ${p.grid ?? ''}
    ${p.strip ?? ''}
    ${sources}
  </article>`;
}

export function renderSections({ cov, an, prep, ctx, proof, intro = {} }) {
  const byId = new Map(activityRows(cov).map((r) => [r.id, r]));
  return SECTIONS.map((sec) => {
    const rows = sec.activities.map((id) => byId.get(id)).filter(Boolean);
    if (!rows.length) return '';
    // One activity named like its section: the section heading is enough.
    const single = rows.length === 1 && rows[0].label.toLowerCase() === sec.label.toLowerCase();
    return `<section id="s-${esc(sec.id)}" class="block" aria-labelledby="s-${esc(sec.id)}-h"><h2 id="s-${esc(sec.id)}-h">${esc(sec.label)}</h2>
      ${intro[sec.id] ?? ''}
      <div class="alist">${rows.map((r) => activityBlock(r, an.reads.get(r.id), prep, ctx, proof, { single })).join('')}</div></section>`;
  }).filter(Boolean).join('\n');
}

export const uncoveredActivities = (cov) => activityRows(cov).filter((r) => r.state === 'uncovered');
