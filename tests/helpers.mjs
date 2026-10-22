import { ACTIVITIES } from '../scripts/activities.mjs';

// Make these activities invisible to the report, so they render as "Not covered": their evidence items move to a
// channel no activity reads (ids stay, so citations still resolve), and the structured blocks that cite them and
// the Google ads list are removed.
export function dropActivities(evidence, ids) {
  const ev = structuredClone(evidence);
  const channels = new Set(ACTIVITIES.filter((a) => ids.includes(a.id)).flatMap((a) => a.channels));
  const gone = new Set();
  for (const i of ev.items) if (channels.has(i.channel)) { i.channel = 'hiring'; gone.add(i.id); }
  const refOf = (x) => x?.evidence_id ?? x?.evidence_ref;
  for (const [k, v] of Object.entries(ev)) {
    if (Array.isArray(v) && k !== 'items') ev[k] = v.filter((x) => !gone.has(refOf(x)));
    else if (v && typeof v === 'object' && gone.has(refOf(v))) delete ev[k];
  }
  if (ids.includes('google_ads')) { delete ev.ads; delete ev.ads_total; }
  return ev;
}

// The HTML of one activity block (article#a-<id>; "act un" when the activity was not covered), which is what used to be a "pane".
export const ACT_RE = (id) => new RegExp(`<article class="act(?: solo| un)?" id="a-${id}">`);
export function paneOf(html, id) {
  const m = html.match(ACT_RE(id));
  if (!m) throw new Error(`no activity block for ${id}`);
  const part = html.slice(m.index + m[0].length);
  // Post cards are <article> too, so end at the next activity block or the end of the section instead of the first </article>.
  return part.split(/<article class="act(?: solo| un)?" id=/)[0].split('</section>')[0];
}
// The example strip inside an activity block ('' if none). The strip is followed by folds, an inline block or the end.
export function stripOf(pane) {
  const i = pane.indexOf('<div class="strip">');
  if (i < 0) return '';
  const rest = pane.slice(i);
  const ends = [rest.indexOf('<details'), rest.indexOf('<div class="inl">')].filter((n) => n >= 0);
  return ends.length ? rest.slice(0, Math.min(...ends)) : rest;
}
export const stripItems = (strip) => strip.split('<div class="strip-item').slice(1);
// The HTML of one top-level section, by id ('' if absent): from its opening tag to its closing tag.
export function sectionOf(html, id) {
  const m = html.match(new RegExp(`<section id="${id}"[^>]*>`));
  if (!m) return '';
  return html.slice(m.index).split('</section>')[0];
}
// The labelled facts of an activity block (dl.kf) as a Map of label -> the row's html. Empty when the block has none.
export function kfRows(pane) {
  const dl = pane.match(/<dl class="kf">([\s\S]*?)<\/dl>/);
  const rows = new Map();
  if (!dl) return rows;
  for (const m of dl[1].matchAll(/<div(?: class="w")?><dt>([^<]*)<\/dt><dd>([\s\S]*?)<\/dd><\/div>/g)) rows.set(m[1], m[2]);
  return rows;
}
// The account chips (.chans > a.chan) in a section's html, as { href, platform, name, owner, handle, followers, stats, html }.
// name and stats come from the chip's title ("LinkedIn, company. 11 posts sampled, latest 15 Oct").
export function chanCards(sectionHtml) {
  const box = sectionHtml.match(/<div class="chans"[^>]*>([\s\S]*?)<\/div>(?=\s*<div class="alist")/)?.[1] ?? '';
  const unesc = (t) => t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return box.split('<a class="chan"').slice(1).map((c) => {
    const title = unesc(c.match(/title="([^"]*)"/)[1]);
    return {
      href: c.match(/href="([^"]*)"/)[1],
      platform: c.match(/class="cmark cm-([\w-]+)"/)[1],
      name: title.split(',')[0],
      owner: c.match(/<span class="cown">([^<]*)<\/span>/)[1],
      handle: c.match(/<b class="chandle">([^<]*)<\/b>/)[1],
      followers: c.match(/<span class="cmeta">([\s\S]*?)<span class="cown">/)[1],
      stats: title.slice(title.indexOf('. ') + 2),
      html: c,
    };
  });
}
