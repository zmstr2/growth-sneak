import { ACTIVITIES } from '../scripts/rubric.mjs';

// Scores for every rubric activity (so every pane is rendered), each citing evidence from its own channels.
// `over` sets or removes single activities: { video: 80, events: null } (null = not covered).
export function allScores(evidence, over = {}) {
  const activities = {};
  ACTIVITIES.forEach((a, i) => {
    const v = a.id in over ? over[a.id] : 90 - i * 3;
    if (v === null) return;
    activities[a.id] = { score: v, confidence: 0.9, basis: 'jev', evidence_ids: evidence.items.filter((i) => a.channels.includes(i.channel)).slice(0, 2).map((i) => i.id) };
  });
  return { activities };
}

// The HTML of one activity block (article#a-<id>; "act un" when the activity was not covered), which is what used to be a "pane".
export const ACT_RE = (id) => new RegExp(`<article class="act(?: un)?" id="a-${id}">`);
export function paneOf(html, id) {
  const m = html.match(ACT_RE(id));
  if (!m) throw new Error(`no activity block for ${id}`);
  const part = html.slice(m.index + m[0].length);
  // Post cards are <article> too, so end at the next activity block or the end of the section instead of the first </article>.
  return part.split(/<article class="act(?: un)?" id=/)[0].split('</section>')[0];
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
  for (const m of dl[1].matchAll(/<div><dt>([^<]*)<\/dt><dd>([\s\S]*?)<\/dd><\/div>/g)) rows.set(m[1], m[2]);
  return rows;
}
// The channel cards (.chans > a.chan) in a section's html, as { href, platform, name, owner, handle, followers, stats, html }.
export function chanCards(sectionHtml) {
  const box = sectionHtml.match(/<div class="chans"[^>]*>([\s\S]*?)<\/div>(?=\s*<article)/)?.[1] ?? '';
  return box.split('<a class="chan"').slice(1).map((c) => ({
    href: c.match(/href="([^"]*)"/)[1],
    platform: c.match(/class="cmark cm-([\w-]+)"/)[1],
    name: c.match(/<b class="cname">([^<]*)<\/b>/)[1],
    owner: c.match(/<span class="cown">([^<]*)<\/span>/)[1],
    handle: c.match(/<span class="chandle">([^<]*)<\/span>/)[1],
    followers: c.match(/<span class="cnum">([\s\S]*?)<\/span>\s*<span class="cstats/)[1],
    stats: c.match(/<span class="cstats[^"]*">([^<]*)<\/span>/)[1],
    html: c,
  }));
}
