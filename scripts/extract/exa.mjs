// Exa results (web_search_exa, web_fetch_exa) are plain text: blocks that start "Title: ... URL: ... Published: ...
// Author: ... Highlights: ...", with an "## Engagement" list when the page showed counts. This reads those blocks.
import { isoDay, norm } from '../lib/calls.mjs';
import { fmtDate } from '../util.mjs';

export function parseExaResults(text) {
  const blocks = String(text ?? '').split(/(?:^|\n\n---\n\n)(?=Title: )/).filter((b) => /^Title: /.test(b));
  return blocks.map((raw) => {
    const head = (k) => { const m = new RegExp(`^${k}: (.*)$`, 'm').exec(raw); return m ? m[1].trim() : null; };
    const eng = {};
    const sec = /## Engagement\s*\n([\s\S]*?)(?:\n\n---|\n## |$)/.exec(raw);
    if (sec) for (const m of sec[1].matchAll(/^- ([A-Za-z ]+): ([\d,]+)\s*$/gm)) eng[m[1].trim().toLowerCase()] = Number(m[2].replace(/,/g, ''));
    return { raw, title: head('Title'), url: head('URL'), published: head('Published'), author: head('Author'), engagement: eng };
  });
}

// The post's own words: the highlights up to the engagement list, without the page title line, image captions or
// the "..." that Exa puts where it cut the page.
export function postText(raw) {
  let t = raw.split(/\nHighlights:\n?/)[1] ?? '';
  t = t.split(/\n## Engagement/)[0].split(/\n\n\.\.\.\n\n/)[0];
  const parts = t.split(/\n\n---\n\n/);
  if (parts.length > 1 && /LinkedIn/.test(parts[0])) t = parts.slice(1).join('\n\n---\n\n');
  return t.split('\n').filter((l) => !/ image\s*$/.test(l) && !/^# /.test(l)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const LI = /^https?:\/\/(?:[a-z]+\.)?linkedin\.com\/(?:posts\/([^_/?#]+)_|feed\/update\/)/i;
const METRIC = { reactions: 'reactions', likes: 'reactions', comments: 'comments', reposts: 'reposts', shares: 'reposts' };

export function extractLinkedInPosts(calls, ctx) {
  const posts = []; const items = []; const skipped = []; const outside = []; const seen = new Set(); const by = new Map();
  for (const call of calls) {
    if (!/(web_search_exa|web_fetch_exa|web_search_advanced_exa)$/.test(call.tool)) continue;
    parseExaResults(call.text).forEach((b, i) => {
      const m = b.url && LI.exec(b.url);
      if (!m) return;
      // The account comes from the post's own URL or its author. A result with neither ("Author: N/A") is not attributed to anyone.
      const author = /^(n\/a|na|none|unknown|-)$/i.test(String(b.author ?? '').trim()) ? '' : String(b.author ?? '');
      const slug = (m[1] || author.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')) || null;
      const published = isoDay(b.published); const text = postText(b.raw);
      if (!slug || !published || !text) { skipped.push({ call: `${call.ref}#exa:${i}`, why: `result has no ${!slug ? 'account (no author and none in the URL)' : !published ? 'date' : 'text'}: ${b.url}` }); return; }
      if (seen.has(b.url)) return;
      seen.add(b.url);
      if (ctx.cutoff && published < ctx.cutoff) { outside.push({ url: b.url, published }); return; }
      const metrics = {};
      for (const [k, v] of Object.entries(b.engagement)) if (METRIC[k]) metrics[METRIC[k]] = v;
      const owner = ctx.ownerOf(slug, 'linkedin'); const kind = ctx.kindOf(b.url);
      posts.push({
        platform: 'linkedin', account: slug, owner, url: b.url, published, text,
        ...(Object.keys(metrics).length ? { metrics } : {}), ...(kind ? { kind } : {}),
        evidence_ref: `auto-li-${slug}`, raw_ref: `${call.ref}#exa:${i}`,
      });
      const g = by.get(slug) ?? { slug, owner, dates: [], call: call.ref };
      g.dates.push(published); by.set(slug, g);
    });
  }
  for (const g of by.values()) {
    const d = [...g.dates].sort(); const n = g.dates.length;
    const range = d[0] === d.at(-1) ? fmtDate(d[0]) : `${fmtDate(d[0])} to ${fmtDate(d.at(-1))}`;
    items.push({
      ref: `auto-li-${g.slug}`, channel: g.owner === 'founder' ? 'founder_social' : 'social', status: 'observed',
      finding: `${n} LinkedIn post${n === 1 ? '' : 's'} from ${g.slug} (${range}) found through Exa search. Counts are shown only where the page showed them.`,
      url: `https://www.linkedin.com/${g.owner === 'company' ? 'company' : 'in'}/${g.slug}/`, raw_ref: g.call,
    });
  }
  return { layer: 'social', posts, items, skipped, outside };
}
void norm;
