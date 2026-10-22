// What we could see for each growth activity, decided in code from evidence.json. Nothing is scored.
//
//   seen      we recorded at least one fact for it (an observed or stated item, or a structured block such as
//             posts, ads or a sitemap summary)
//   absent    we ran a check on the company's own surface and found nothing (an item with absent: true + probe)
//   uncovered we could not look, or the check failed. Shown as "Not covered", never as "none".
//
// An activity with no usable evidence is never "absent": zero pages in a sitemap is not a checked absence.

import { ACTIVITIES } from './activities.mjs';

const isFact = (i) => ['observed', 'stated'].includes(i.status) && !i.absent;

// Evidence ids behind an activity: its fact items, plus the item behind each structured block that belongs to it.
export function evidenceFor(activity, ev) {
  const items = ev.items.filter((i) => activity.channels.includes(i.channel));
  const ids = new Set(items.filter(isFact).map((i) => i.id));
  const add = (id) => { if (id) ids.add(id); };
  const posts = ev.posts ?? [];
  const firstOf = (list) => list.find((p) => p.evidence_id)?.evidence_id;
  if (activity.id === 'organic_social') add(firstOf(posts.filter((p) => p.owner === 'company' && !p.reply)));
  if (activity.id === 'founder_social') {
    add(firstOf(posts.filter((p) => p.owner === 'founder' && !p.reply)));
    for (const a of (ev.accounts ?? []).filter((x) => x.owner === 'founder' && x.followers > 0)) add(a.evidence_id);
  }
  if (activity.id === 'google_ads' && (ev.ads ?? []).some((x) => x.own !== false)) add(items.find(isFact)?.id);
  if (activity.id === 'paid_social' && ev.meta_ads?.ads?.length) add(ev.meta_ads.evidence_id);
  if (activity.id === 'owned_content' && ev.content?.items?.length) add(ev.content.evidence_id);
  if (activity.id === 'seo_content' && ev.site?.total_urls) add(ev.site.evidence_id);
  if (activity.id === 'comparison' && ev.site?.page_types?.comparison?.urls > 0) add(ev.site.evidence_id);
  if (activity.id === 'customer_proof' && ev.site?.page_types?.customers?.urls > 0) add(ev.site.evidence_id);
  if (activity.id === 'community' && ev.community) {
    if (ev.community.discord?.members > 0) add(ev.community.discord.evidence_id);
    if (ev.community.hacker_news?.stories > 0) add(ev.community.hacker_news.evidence_id);
  }
  if (activity.id === 'open_source' && ev.oss?.repos > 0) add(ev.oss.evidence_id);
  if ((activity.id === 'pricing' || activity.id === 'signup_entry') && ev.pricing?.plans?.length) add(ev.pricing.evidence_id);
  if (activity.id === 'aeo' && ev.site_checks?.checks?.length) add(ev.site_checks.evidence_id);
  if (activity.id === 'partnerships' && ev.site?.page_types?.integrations?.urls > 0) add(ev.site.evidence_id);
  return {
    items,
    seen: [...ids],
    absent: items.filter((i) => i.absent),
    unchecked: items.filter((i) => i.status === 'couldnt_check'),
  };
}

// One entry per activity: { state, evidence_ids, probe? }.
export function coverage(ev) {
  const activities = {};
  for (const a of ACTIVITIES) {
    const e = evidenceFor(a, ev);
    if (e.seen.length) activities[a.id] = { state: 'seen', evidence_ids: e.seen };
    else if (e.absent.length) activities[a.id] = { state: 'absent', evidence_ids: e.absent.map((i) => i.id), probe: e.absent[0].probe };
    else activities[a.id] = { state: 'uncovered', evidence_ids: e.unchecked.map((i) => i.id) };
  }
  return { activities };
}
