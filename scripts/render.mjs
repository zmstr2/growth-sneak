#!/usr/bin/env node
// Growth Sneak renderer: evidence.json + analysis.json -> one self-contained report.html.
// No dependencies, no model. The same input always gives the same output.
//
//   node scripts/render.mjs reports/<domain> [--open]
//
// The page leads with the answer and the strongest growth plays, then what to take from it, then one
// block per growth activity with its score and the proof behind it (a post, an ad or a page screenshot),
// then site traffic, tech stack and what we could not see.
//
// The analysis it reads is: company, headline (or summary), reads, plays, takeaways and couldnt_see.
// Anything else in analysis.json is ignored.
//
// Honesty rules are enforced here, not left to prompts:
//   * a claim with no evidence ids is dropped (warning)
//   * an unknown evidence id is a hard error (the data is broken)
//   * an activity id the rubric does not know (in scores.json or the analysis) is ignored with a warning
//   * a score of 0 from a checked absence needs a recorded check (absent:true + probe); an activity with
//     no evidence is "Not covered", never 0

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeMetrics } from './social.mjs';
import { execFile } from 'node:child_process';
import { CHANNELS, CHANNEL_BY_ID, SOURCE_LABELS } from './channels.mjs';
import { esc, safeUrl, fmtDate, short, listJoin, emphasize, hasPreview, MIN_THUMB_WIDTH } from './util.mjs';
import { KIND_LABEL } from './exhibits.mjs';
import { ACTIVITY_BY_ID } from './rubric.mjs';
import { fallbackScores } from './score.mjs';
import { renderPlays, renderTake, renderSections, uncoveredActivities, scoreRows, SECTIONS, STRONG_FROM } from './scoreboard.mjs';
import { makeProof, renderTraffic, renderTech, renderChannelCards } from './proof.mjs';

export { esc, safeUrl, fmtDate, hasPreview, MIN_THUMB_WIDTH };

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(HERE, '..', 'templates', 'report.html');
const VERSION = JSON.parse(readFileSync(join(HERE, '..', '.claude-plugin', 'plugin.json'), 'utf8')).version;

const STATUSES = ['observed', 'stated', 'couldnt_check'];
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

// ---------- validation / honesty rules ----------

const norm = (t) => String(t ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// The Move sentence of every card in references/plays.md, to catch a takeaway that copies it unchanged.
function playMoves() {
  try {
    const md = readFileSync(join(HERE, '..', 'references', 'plays.md'), 'utf8');
    return new Set([...md.matchAll(/\*\*Move\.\*\*\s*(.+)/g)].map((m) => norm(m[1])));
  } catch { return new Set(); }
}

class DataError extends Error {}

export function prepare(evidence, analysis, scores = null) {
  const warnings = [];
  const warn = (m) => warnings.push(m);

  if (!evidence || !Array.isArray(evidence.items)) throw new DataError('evidence.json: "items" must be an array');
  if (!evidence.domain) throw new DataError('evidence.json: "domain" is required');
  if (!analysis || typeof analysis !== 'object') throw new DataError('analysis.json: must be an object');

  const byId = new Map();
  for (const it of evidence.items) {
    if (!it.id || !/^[A-Za-z0-9_-]+$/.test(it.id)) throw new DataError(`evidence item has a bad id: ${JSON.stringify(it.id)}`);
    if (byId.has(it.id)) throw new DataError(`duplicate evidence id ${it.id}`);
    if (!CHANNEL_BY_ID[it.channel]) throw new DataError(`${it.id}: unknown channel "${it.channel}"`);
    if (!STATUSES.includes(it.status)) throw new DataError(`${it.id}: status must be one of ${STATUSES.join(', ')}`);
    if (!it.finding || typeof it.finding !== 'string') throw new DataError(`${it.id}: "finding" is required`);
    if (!safeUrl(it.url)) throw new DataError(`${it.id}: "url" must be an http(s) link`);
    if (it.absent && (it.status !== 'observed' || !it.probe)) {
      throw new DataError(`${it.id}: a checked absence needs status "observed" and a "probe" describing what was checked`);
    }
    byId.set(it.id, it);
  }

  const ads = (evidence.ads ?? []).map((a) => {
    if (!a.id || !safeUrl(a.url)) throw new DataError(`ad ${a.id}: needs an id and an http(s) url`);
    if (typeof a.days_shown !== 'number') throw new DataError(`ad ${a.id}: days_shown must be a number`);
    return a;
  });

  // Structured tables (all optional). Each must point at the evidence item it came from.
  const linked = (name, obj, check) => {
    if (obj == null) return null;
    if (!obj.evidence_id || !byId.has(obj.evidence_id)) throw new DataError(`${name}: "evidence_id" must name an existing evidence item`);
    check(obj);
    return obj;
  };
  const site = linked('site', evidence.site, (s) => {
    if (!Array.isArray(s.sections)) throw new DataError('site: "sections" must be an array');
    for (const x of s.sections) if (typeof x.urls !== 'number' || !x.path) throw new DataError('site: each section needs "path" and a numeric "urls"');
  });
  const siteChecks = linked('site_checks', evidence.site_checks, (s) => {
    for (const c of s.checks ?? []) if (!['yes', 'no', 'unknown'].includes(c.result)) throw new DataError(`site_checks: "${c.check}" result must be yes, no or unknown`);
  });
  const tech = linked('tech', evidence.tech, (t) => {
    if (!Array.isArray(t.tools)) throw new DataError('tech: "tools" must be an array');
  });
  const traffic = linked('traffic', evidence.traffic, (t) => {
    if (!Array.isArray(t.points) || t.points.some((x) => !/^\d{4}-\d{2}$/.test(String(x.month)) || !Number.isFinite(x.value) || x.value < 0)) throw new DataError('traffic: "points" must be a list of { month: "YYYY-MM", value } with value a number of zero or more');
  });
  const metaAds = linked('meta_ads', evidence.meta_ads, (m) => {
    if (!Array.isArray(m.ads)) throw new DataError('meta_ads: "ads" must be an array');
    for (const a of m.ads) if (!a.id || !safeUrl(a.url)) throw new DataError(`meta_ads: ad ${a.id} needs an id and an http(s) "url"`);
  });
  const pricing = linked('pricing', evidence.pricing, (p) => {
    if (!Array.isArray(p.plans) || p.plans.some((x) => !x.name || !x.price)) throw new DataError('pricing: each plan needs "name" and "price"');
  });

  // Keep an entry only if it cites at least one real evidence id.
  const cleanList = (list, label) => {
    const out = [];
    for (const entry of list ?? []) {
      const ids = entry.evidence_ids;
      if (!Array.isArray(ids) || ids.length === 0) {
        warn(`${label}: dropped a claim with no evidence ids: "${String(entry.text ?? entry.read ?? '').slice(0, 70)}"`);
        continue;
      }
      for (const id of ids) {
        if (!byId.has(id)) throw new DataError(`${label}: cites unknown evidence id ${id}`);
      }
      out.push(entry);
    }
    return out;
  };

  const couldntSee = cleanList(analysis.couldnt_see, 'couldnt_see');

  // Score-led content. Each sentence must cite real evidence or it is dropped; a bad activity id is dropped with a warning.
  const known = (label, list) => list.filter((x) => {
    if (ACTIVITY_BY_ID[x.activity]) return true;
    warn(`${label}: dropped an entry for unknown activity "${x.activity}"`);
    return false;
  });
  const headline = analysis.headline ? (cleanList([analysis.headline], 'headline')[0] ?? null) : null;
  const reads = new Map(known('reads', cleanList(analysis.reads, 'reads')).map((r) => [r.activity, r]));
  // The analyst's picks for the hero cards: only activities that are shown and have a score can be a play.
  const scoredIds = scores ? new Set(scoreRows(scores).filter((r) => r.state === 'scored').map((r) => r.id)) : null;
  const plays = known('plays', (analysis.plays ?? []).filter((x) => x && x.activity)).filter((x) => {
    if (scoredIds && !scoredIds.has(x.activity)) { warn(`plays: dropped "${x.activity}" (it has no score, so it cannot be a growth play)`); return false; }
    return true;
  });
  const positive = scores ? new Set(scoreRows(scores).filter((r) => r.state === 'scored' && r.score > 0).map((r) => r.id)) : null;
  const cardMoves = playMoves();
  const takeaways = known('takeaways', cleanList(analysis.takeaways, 'takeaways')).filter((t) => {
    if (!t.move || !t.observed) { warn(`takeaways: dropped "${t.activity}" (needs observed and move)`); return false; }
    if (positive && !positive.has(t.activity)) { warn(`takeaways: dropped "${t.activity}" (no move is taken from an activity scored 0 or not covered)`); return false; }
    if (cardMoves.has(norm(t.move))) warn(`takeaways: the move for "${t.activity}" copies references/plays.md word for word; write it for this company`);
    return true;
  });
  if (scores) {
    for (const [id, sc] of Object.entries(scores.activities ?? {})) {
      // An activity the rubric no longer has (an older scores.json) is ignored, not shown.
      if (!ACTIVITY_BY_ID[id]) { warn(`scores.json: ignored unknown activity "${id}"`); continue; }
      for (const e of sc.evidence_ids ?? []) if (!byId.has(e)) throw new DataError(`scores.json: ${id} cites unknown evidence id ${e}`);
    }
  }

  const summary = analysis.summary ? cleanList([analysis.summary], 'summary')[0] ?? null : null;

  // Social and community collections. Every post and account points at its evidence item.
  const needEv = (label, id) => { if (!id || !byId.has(id)) throw new DataError(`${label}: "evidence_id" must name an existing evidence item`); };
  const posts = (evidence.posts ?? []).map((p, i) => {
    needEv(`posts[${i}]`, p.evidence_id);
    if (!p.platform || !p.account) throw new DataError(`posts[${i}]: needs "platform" and "account"`);
    if (!safeUrl(p.url)) throw new DataError(`posts[${i}]: "url" must be an http(s) link`);
    if (!Number.isFinite(Date.parse(p.published))) throw new DataError(`posts[${i}]: "published" must be a date`);
    return { ...p, metrics: normalizeMetrics(p.platform, p.metrics), id: p.id ?? `P${String(i + 1).padStart(3, '0')}` };
  });
  // Page screenshots: the dedicated list, plus any evidence item that carries an image (older data).
  const screens = (evidence.screens ?? []).map((x, i) => {
    needEv(`screens[${i}]`, x.evidence_id);
    if (!safeUrl(x.page_url)) throw new DataError(`screens[${i}]: "page_url" must be an http(s) link`);
    if (!x.image) throw new DataError(`screens[${i}]: "image" is required`);
    return { ...x, id: x.id ?? `S${String(i + 1).padStart(2, '0')}`, kind: x.kind ?? 'other' };
  });
  for (const it of evidence.items) {
    if (!it.image || screens.some((x) => x.image === it.image)) continue;
    const label = KIND_LABEL[it.funnel_step] ?? '';
    const caption = label ? it.finding.replace(new RegExp(`^${label}( page)?[.:,]?\\s*`, 'i'), '').replace(/^./, (c) => c.toUpperCase()) : it.finding;
    screens.push({ id: `S-${it.id}`, kind: it.funnel_step ?? 'other', page_url: it.url, image: it.image, caption, evidence_id: it.id });
  }
  const accounts = (evidence.accounts ?? []).map((a, i) => {
    needEv(`accounts[${i}]`, a.evidence_id);
    if (!safeUrl(a.url)) throw new DataError(`accounts[${i}]: "url" must be an http(s) link`);
    return a;
  });
  const oss = evidence.oss ? (needEv('oss', evidence.oss.evidence_id), evidence.oss) : null;
  const community = evidence.community ?? null;
  if (community?.discord) needEv('community.discord', community.discord.evidence_id);
  if (community?.hacker_news) needEv('community.hacker_news', community.hacker_news.evidence_id);

  return {
    byId,
    ads,
    screens,
    site,
    siteChecks,
    tech,
    traffic,
    metaAds,
    pricing,
    posts,
    accounts,
    oss,
    community,
    warnings,
    // Only what the report shows. Each part cites evidence or was dropped above.
    analysis: {
      company: analysis.company ?? null,
      headline,
      summary,
      reads,
      plays,
      takeaways,
      couldnt_see: couldntSee,
    },
  };
}

// ---------- images ----------

function imageSrc(ref, baseDir, warn) {
  if (!ref) return null;
  if (safeUrl(ref)) return ref;
  const root = resolve(baseDir);
  const file = resolve(root, ref);
  if (!file.startsWith(root + sep)) { warn(`image path escapes the report folder, skipped: ${ref}`); return null; }
  const mime = MIME[extname(file).toLowerCase()];
  if (!mime) { warn(`unsupported image type, skipped: ${ref}`); return null; }
  if (!existsSync(file)) { warn(`image file missing, skipped: ${ref}`); return null; }
  if (statSync(file).size > MAX_IMAGE_BYTES) { warn(`image over 3 MB, skipped: ${ref}`); return null; }
  return `data:${mime};base64,${readFileSync(file).toString('base64')}`;
}

// ---------- rendering context: footnote numbers ----------

function makeCtx(prep) {
  const fnum = new Map(); // evidence id -> footnote number, in reading order
  let panels = 0;
  const num = (id) => {
    if (!fnum.has(id)) fnum.set(id, fnum.size + 1);
    return fnum.get(id);
  };

  const extLink = (url, text, label) =>
    `<a class="ext" href="${esc(url)}" target="_blank" rel="noopener noreferrer"${label ? ` aria-label="${esc(label)}"` : ''}>${esc(text)}<span aria-hidden="true"> ↗</span></a>`;

  const statusWord = (it) => {
    if (it.absent) return '<span class="st">Checked absence</span>';
    if (it.status === 'stated') return '<span class="st">Stated by the company</span>';
    if (it.status === 'couldnt_check') return '<span class="st">Unconfirmed</span>';
    return '';
  };

  // A statement with quiet footnote numbers; the numbers open its sources right underneath.
  const claim = (text, ids, { tag = 'div', cls = '', emph = false } = {}) => {
    const k = ++panels;
    // Runs of three or more consecutive numbers read as a range ("1–6"), not six separate marks.
    const nums = [...new Set(ids.map(num))].sort((a, b) => a - b);
    const runs = [];
    for (const n of nums) {
      const last = runs.at(-1);
      if (last && n === last[1] + 1) last[1] = n; else runs.push([n, n]);
    }
    const parts = runs.flatMap(([a, b]) => (b - a >= 2 ? [[a, b]] : Array.from({ length: b - a + 1 }, (_, i) => [a + i, a + i])));
    const sups = parts.map(([a, b]) => {
      const label = a === b ? `Show source ${a}` : `Show sources ${a} to ${b}`;
      return `<button class="fn" type="button" aria-expanded="false" aria-controls="fp${k}" aria-label="${label}">${a === b ? a : `${a}–${b}`}</button>`;
    }).join('');
    const rows = ids.map((id) => {
      const it = prep.byId.get(id);
      return `<li><span class="n">${num(id)}</span><span>${esc(it.finding)} ${statusWord(it)} ${extLink(it.url, 'Source', `Source for: ${short(it.finding)}`)}</span></li>`;
    }).join('');
    return `<${tag} class="claim ${cls}"><p>${emph ? emphasize(esc(text)) : esc(text)}<sup class="fns">${sups}</sup></p><div class="srcs" id="fp${k}" hidden><ol>${rows}</ol></div></${tag}>`;
  };

  // A footnote number that jumps to the item in the Sources appendix (for tables and captions).
  const ref = (id) => { const it = prep.byId.get(id); return `<sup class="fns"><a class="fnlink" href="${esc(it.url)}" target="_blank" rel="noopener noreferrer" aria-label="Source: ${esc(short(it.finding))}">↗</a></sup>`; };

  return { num, fnum, claim, extLink, statusWord, ref };
}


// The closing section: activities we could not score, channels with no usable evidence at all, plus the analyst's gaps.
// A channel is "not covered" when none of its items is observed or stated and no absence was recorded for it
// (items we could not check do not count). Traffic, hiring and martech are context, not growth channels, so never listed.
function renderGaps(ev, an, prep, ctx, scores) {
  const seen = new Set(ev.items.filter((i) => i.status !== 'couldnt_check' || i.absent).map((i) => i.channel));
  if (prep.ads.length) seen.add('google_ads');
  const notCovered = CHANNELS.filter((c) => !seen.has(c.id) && !['traffic', 'hiring', 'martech'].includes(c.id));
  const cs = an.couldnt_see.map((c) => { const it = prep.byId.get(c.evidence_ids[0]); return `<li>${esc(c.text)}${it ? ` ${ctx.extLink(it.url, 'Source', `Source for: ${short(it.finding)}`)}` : ''}</li>`; });
  const unscored = scores ? uncoveredActivities(scores) : [];
  if (!cs.length && !notCovered.length && !unscored.length) return '';
  return `<section id="gaps" class="block card" aria-labelledby="gaps-h">
  <h2 id="gaps-h">What we could not see</h2>
  ${unscored.length ? `<p class="gapline"><b>Not scored:</b> ${esc(listJoin(unscored.map((r) => r.label)))}. We had no evidence to score ${unscored.length === 1 ? 'it' : 'these'}, which is not the same as a score of 0.</p>` : ''}
  ${notCovered.length ? `<p class="gapline"><b>Not covered:</b> ${esc(listJoin(notCovered.map((c) => c.label)))}.</p>` : ''}
  ${cs.length ? `<ul class="plain gapl">${cs.join('')}</ul>` : ''}
</section>`;
}

function renderHero(ev, an, ctx, scores) {
  const name = an.company?.name || ev.domain;
  const lede = an.headline ?? an.summary;
  const refs = lede ? lede.evidence_ids.slice(0, 2).map((id) => ctx.ref(id)).join('') : '';
  const plays = scores ? renderPlays(scores, an) : '';
  return `<header id="summary" class="hero" aria-label="Overview">
  <div class="brand">
    <img class="logo" src="https://www.google.com/s2/favicons?domain=${esc(encodeURIComponent(ev.domain))}&amp;sz=128" alt="" width="56" height="56" referrerpolicy="no-referrer">
    <div><h1>${esc(name)}</h1>
    <p class="meta"><a class="ext" href="https://${esc(ev.domain)}" target="_blank" rel="noopener noreferrer">${esc(ev.domain)}<span aria-hidden="true"> ↗</span></a> · Collected ${esc(fmtDate(ev.captured_at, { year: true }))} · Public data only</p></div>
  </div>
  ${lede ? `<p class="lede">${esc(lede.text)}${refs}</p>` : ''}
  ${ev.note ? `<p class="note">${esc(ev.note)}</p>` : ''}
  ${plays ? `<h2 class="hsub">Their strongest growth plays</h2>${plays}` : ''}
</header>`;
}

// A slim bar that stays at the top while you read; the script marks the section you are in.
function renderRail(sections) {
  // [id, label, score?]: a section's score is its highest scored activity; sections with nothing scored show none.
  return `<nav class="rail" aria-label="Sections"><ol>${sections.map(([id, label, score]) => `<li><a href="#${id}"><span>${esc(label)}</span>${Number.isFinite(score) ? `<b class="rs ${score >= STRONG_FROM ? 's-g' : 's-n'}"><span class="sr-only">top score </span>${score}</b>` : ''}</a></li>`).join('')}</ol></nav>`;
}

function renderAbout(ev, prep, scoreBasis = null) {
  const sources = ev.sources ?? {};
  const used = Object.keys(SOURCE_LABELS).filter((s) => sources[s] === 'connected').map((s) => SOURCE_LABELS[s]);
  const scored = scoreBasis ? `Scores by ${scoreBasis === 'jev' ? 'Jev (TypeSafe)' : 'an analyst agent'}, 0 to 100 on a four-level rubric.` : '';
  const cost = ev.cost?.firecrawl_credits != null ? `Cost: ${esc(ev.cost.firecrawl_credits)} Firecrawl credits.` : '';
  const adjusted = prep.warnings.length
    ? ` ${prep.warnings.length} ${prep.warnings.length === 1 ? 'item was' : 'items were'} left out or flagged when the page was built (uncited, unknown or not shown).`
    : '';
  return `<footer class="about">
  <p>Made with Growth Sneak ${esc(VERSION)} on ${esc(fmtDate(ev.captured_at))}. ${used.length ? `Data: ${esc(listJoin(used))}.` : 'No data sources were connected.'} ${esc(scored)} ${cost}${adjusted}</p>
  <p>This page describes what a company does in public and suggests moves to consider. The moves are suggestions, not facts. Missing evidence is not proof that something is absent.</p>
</footer>`;
}

// ---------- assemble ----------

export function renderReport(evidence, analysis, { baseDir = '.', scores: given = null } = {}) {
  // Scores: scores.json if given, else the analyst's levels on the same rubric, else none (the board is left out).
  const scores = given ?? (analysis.activity_levels?.length ? fallbackScores(analysis, evidence) : null);
  const scoreBasis = scores && Object.values(scores.activities ?? {}).some((a) => a.basis === 'jev') ? 'jev' : 'analyst';
  const prep = prepare(evidence, analysis, scores);
  const warn = (m) => prep.warnings.push(m);
  const an = prep.analysis;
  const ev = { ...evidence, ads: prep.ads };
  const ctx = makeCtx(prep);

  // Render in reading order so footnote numbers ascend down the page.
  const asOf = evidence.captured_at;
  prep.asOfYear = new Date(asOf).getUTCFullYear();
  const shotCache = new Map();
  const shotSrc = (x) => { if (!shotCache.has(x.id)) shotCache.set(x.id, imageSrc(x.image, baseDir, warn)); return shotCache.get(x.id); };
  const shown = new Set(); // posts, ads and screenshots already drawn, so nothing appears twice
  const hero = renderHero(ev, an, ctx, scores);
  const take = scores ? renderTake({ an, scores, ctx }) : '';
  const proof = makeProof({ prep, an, ctx, shown, shotSrc, ev, asOf, domain: evidence.domain });
  const sectionsHtml = scores ? renderSections({ scores, an, prep, ctx, proof, intro: { organic: renderChannelCards(prep, asOf) } }) : '';
  const traffic = renderTraffic(prep, ctx);
  const tech = renderTech(prep, ctx);
  const gaps = renderGaps(ev, an, prep, ctx, scores);
  const about = renderAbout(ev, prep, scores ? scoreBasis : null);

  const present = (id) => sectionsHtml.includes(`id="s-${id}"`);
  const scored = scores ? scoreRows(scores).filter((r) => r.state === 'scored') : [];
  const topScore = (sec) => { const s = scored.filter((r) => sec.activities.includes(r.id)).map((r) => r.score); return s.length ? Math.max(...s) : null; };
  const nav = [['summary', 'Overview'], take ? ['take', 'What to take'] : null, traffic ? ['traffic', 'Site traffic'] : null,
    ...SECTIONS.filter((x) => present(x.id)).map((x) => [`s-${x.id}`, x.label, topScore(x)]),
    tech ? ['tech', 'Tech stack'] : null, gaps ? ['gaps', 'Not seen'] : null].filter(Boolean);
  const body = [
    '<a class="skip" href="#report">Skip to the report</a>',
    '<div class="shell">', renderRail(nav), '<main id="report">',
    hero, take, traffic, sectionsHtml, tech, gaps, about, '</main>', '</div>',
  ].filter(Boolean).join('\n');

  const template = readFileSync(TEMPLATE_PATH, 'utf8');
  const scriptMatch = template.match(/<script>([\s\S]*?)<\/script>/);
  if (!scriptMatch) throw new Error('template has no inline <script>');
  const hash = createHash('sha256').update(scriptMatch[1]).digest('base64');
  const name = an.company?.name || evidence.domain;

  // Function replacers: a plain string would treat "$&" etc. in scraped text as patterns.
  const html = template
    .replace('{{SCRIPT_HASH}}', () => hash)
    .replace('{{TITLE}}', () => esc(`How ${name} grows · Growth Sneak`))
    .replace('{{BODY}}', () => body);
  return { html, warnings: prep.warnings };
}

export function renderDir(dir, { open = false } = {}) {
  const read = (f) => {
    const p = join(dir, f);
    if (!existsSync(p)) throw new DataError(`missing ${p}`);
    try { return JSON.parse(readFileSync(p, 'utf8')); }
    catch (e) { throw new DataError(`${p} is not valid JSON: ${e.message}`); }
  };
  const evidence = read('evidence.json');
  const analysis = read('analysis.json');
  const scores = existsSync(join(dir, 'scores.json')) ? read('scores.json') : null;
  const { html, warnings } = renderReport(evidence, analysis, { baseDir: dir, scores });
  const out = join(dir, 'report.html');
  writeFileSync(out, html);
  if (open) execFile(process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open', [out], () => {});
  return { out, warnings, bytes: Buffer.byteLength(html) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--'));
  if (!dir) { console.error('usage: node scripts/render.mjs <reports/domain> [--open]'); process.exit(2); }
  try {
    const { out, warnings, bytes } = renderDir(dir, { open: args.includes('--open') });
    for (const w of warnings) console.error(`warning: ${w}`);
    console.log(`wrote ${out} (${(bytes / 1024).toFixed(0)} KB)`);
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(e instanceof DataError ? 1 : 3);
  }
}
