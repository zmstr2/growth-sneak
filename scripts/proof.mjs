// Proof for each growth activity: the posts, ads and page screenshots that show it, and the plain facts
// that measure it. Everything is built from the evidence already collected; nothing is invented.
//
//   makeProof(...)(activityId) -> { strip, note, facts, inline }
//     strip: a horizontally scrolling row of examples (posts, ads, screenshots), or ''
//     note: one plain sentence, facts: a small labelled list, inline: a checklist
//
// scoreboard.mjs puts these inside each activity's block, so the evidence sits next to the score it
// supports and nothing is drawn twice.

import { adLibraryLinks, brandFromDomain } from './adlinks.mjs';
import { accountStats, engagementOf, hasMetrics } from './social.mjs';
import { esc, safeUrl, fmtDate, fmtN, hasPreview, MONTHS } from './util.mjs';
import { PLATFORM_LABEL, postCard, adCard, metaAdCard, shotFrame } from './exhibits.mjs';

export const STRIP_MAX = 8;
const SOCIAL = ['x', 'linkedin', 'instagram', 'tiktok'];

const lastSeg = (u) => { try { return decodeURIComponent(new URL(u).pathname.split('/').filter(Boolean).at(-1) ?? ''); } catch { return ''; } };
const titleCase = (slug) => slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bVs\b/g, 'vs');
const ext = (url, text) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`;

// Which screenshot kinds belong to which activity.
const SHOT_KINDS = {
  seo_content: ['blog'],
  comparison: ['comparison'],
  customer_proof: ['customers'],
  signup_entry: ['home', 'product', 'landing', 'signup'],
  pricing: ['pricing'],
  partnerships: ['integrations'],
};

export function strip(label, items, { itemClass = '' } = {}) {
  if (!items.length) return '';
  const nav = items.length > 2
    ? '<span class="strip-nav"><button type="button" data-dir="-1" aria-label="Scroll left">‹</button><button type="button" data-dir="1" aria-label="Scroll right">›</button></span>' : '';
  return `<div class="strip"><div class="strip-head"><span>${esc(label)} <span class="muted">${items.length}</span></span>${nav}</div>
    <div class="strip-track" tabindex="0" role="group" aria-label="${esc(label)}">${items.map((h) => `<div class="strip-item${itemClass ? ` ${itemClass}` : ''}">${h}</div>`).join('')}</div></div>`;
}

export function makeProof({ prep, an, ctx, shown, shotSrc, ev, asOf, domain = '' }) {
  const free = (type, x) => !shown.has(`${type}:${x.id}`);
  const claim = (type, x) => { shown.add(`${type}:${x.id}`); return x; };

  const shotsOf = (kinds) => {
    const order = ['home', 'product', 'landing', 'signup'];
    return prep.screens.filter((s) => kinds.includes(s.kind) && free('shot', s))
      .sort((a, b) => (order.indexOf(a.kind) + 1 || 9) - (order.indexOf(b.kind) + 1 || 9))
      .map((s) => shotFrame(claim('shot', s), shotSrc(s)));
  };

  const postsBy = (pred) => {
    const list = prep.posts.filter((p) => pred(p) && !p.reply && free('post', p));
    const measured = list.filter(hasMetrics).sort((a, b) => engagementOf(b) - engagementOf(a));
    const picked = (measured.length ? measured : [...list].sort((a, b) => b.published.localeCompare(a.published))).slice(0, STRIP_MAX);
    return picked.map((p) => postCard(claim('post', p), { asOfYear: prep.asOfYear }));
  };

  const libLinks = () => adLibraryLinks(ev.domain, ev.brand || brandFromDomain(ev.domain))
    .map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.label.split(' ')[0])}</a>`).join(' · ');
  const libsRow = () => ({ label: 'Ad libraries', html: `${libLinks()} <span class="muted">Meta, LinkedIn and TikTok search by name, so check the advertiser.</span>` });

  const site = prep.site;
  const pt = site?.page_types ?? {};
  const brandSlug = `${String(domain).replace(/\./g, '-')}-`.toLowerCase();
  const pageName = (u) => titleCase(lastSeg(u).toLowerCase().replace(new RegExp(`^${brandSlug.replace(/[-]/g, '[-_]')}`), ''));
  const strip0 = (u) => String(u).replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
  const shotPages = () => new Set(prep.screens.filter((x) => shown.has(`shot:${x.id}`)).map((x) => strip0(x.page_url)));
  // Links not already drawn as a screenshot above, so nothing is said twice.
  const linkRow = (label, urls, name) => {
    const shown = shotPages();
    const seen = new Set();
    const list = urls.filter((u) => { const k = strip0(u); if (shown.has(k) || seen.has(k)) return false; seen.add(k); return true; });
    if (!list.length) return null;
    return { label, html: `${list.slice(0, 8).map((u) => ext(u, name(u))).join(' · ')}${list.length > 8 ? ` <span class="muted">and ${list.length - 8} more</span>` : ''}` };
  };

  // Each builder gives: strip (visual examples), rows (a few labelled facts), inline (a checklist), note.
  const builders = {
    google_ads() {
      const own = prep.ads.filter((a) => a.own !== false);
      const others = prep.ads.length - own.length;
      const previews = own.filter(hasPreview).sort((a, b) => b.days_shown - a.days_shown || a.id.localeCompare(b.id));
      const rest = own.length - previews.length;
      const total = (Number.isFinite(ev.ads_total?.low) && Number.isFinite(ev.ads_total?.high)) ? `Google lists about ${ev.ads_total.low === ev.ads_total.high ? ev.ads_total.low : `${ev.ads_total.low}–${ev.ads_total.high}`} ads for ${ev.domain}. ` : '';
      return {
        strip: strip(previews.length ? 'Longest-running ads first' : '', previews.slice(0, STRIP_MAX).map((a) => adCard(a, { asOfYear: prep.asOfYear }))),
        note: prep.ads.length ? `${total}We collected ${prep.ads.length}${others ? `, of which ${others} ${others === 1 ? 'was' : 'were'} run by other advertisers pointing at the site and ${own.length} by the company` : ''}${rest ? `; ${rest} of the company's ads ${rest === 1 ? 'has' : 'have'} no preview from Google` : ''}.` : '',
        rows: [libsRow()],
      };
    },
    paid_social() {
      const m = prep.metaAds;
      if (!m) return { rows: [libsRow()] };
      const pct = (list) => (list ?? []).slice(0, 3).map((x) => `${Math.round(x.share * 100)}% ${String(x.label).toLowerCase()}`).join(', ');
      const rows = [
        Number.isFinite(m.active_ads) ? { label: 'Active Meta ads', html: `<b>${fmtN(m.active_ads)}</b>${m.as_of ? ` <span class="muted">as of ${esc(fmtDate(m.as_of, { year: true }))}</span>` : ''}` } : null,
        pct(m.creative_mix?.media) ? { label: 'Format', html: esc(pct(m.creative_mix.media)) } : null,
        pct(m.creative_mix?.funnel) ? { label: 'Funnel stage', html: esc(pct(m.creative_mix.funnel)) } : null,
        m.spend?.grade ? { label: 'Spend', html: `Grade ${esc(m.spend.grade)} <span class="muted">${esc(m.spend.floor ?? '')}, ${esc(m.source ?? 'Upspring')} estimate</span>` } : null,
        libsRow(),
      ];
      return { strip: strip('Their best-performing Meta ads', m.ads.slice(0, STRIP_MAX).map((a) => metaAdCard(a, { asOf }))), rows };
    },
    organic_social() { return { strip: strip('Their best posts', postsBy((p) => SOCIAL.includes(p.platform) && p.owner !== 'founder')) }; },
    founder_social() { return { strip: strip('Their best posts', postsBy((p) => SOCIAL.includes(p.platform) && p.owner === 'founder')) }; },
    seo_content() { return { strip: strip('Screenshots', shotsOf(['blog']), { itemClass: 'shot' }) }; },
    aeo() {
      const c = prep.siteChecks;
      if (!c?.checks?.length) return {};
      const GL = { yes: '✓', no: '✕', unknown: '?' };
      const RESULT = { yes: 'Yes', no: 'No', unknown: "Couldn't check" };
      return { inline: `<ul class="ck">${c.checks.map((x) => `<li><span class="gl gl-${x.result}" aria-hidden="true">${GL[x.result]}</span><span><b>${esc(x.check)}</b> <span class="muted">${RESULT[x.result]}${x.detail ? ` · ${esc(x.detail)}` : ''}</span></span></li>`).join('')}</ul>` };
    },
    comparison() {
      const all = (pt.comparison?.examples ?? []).filter(safeUrl);
      // Prefer real comparison pages over blog posts that merely have "vs" in the slug.
      const real = all.filter((u) => { try { return /^\/(compare|vs|versus|alternatives?)(\/|-|$)/i.test(new URL(u).pathname); } catch { return false; } });
      const urls = real.length ? real : all;
      const s = strip('Screenshots', shotsOf(['comparison']), { itemClass: 'shot' });
      return { strip: s, rows: [linkRow('Pages', urls, pageName)] };
    },
    customer_proof() {
      const urls = (pt.customers?.examples ?? []).filter((u) => safeUrl(u) && !/\/customers\/?$/i.test(u));
      const s = strip('Screenshots', shotsOf(['customers']), { itemClass: 'shot' });
      return { strip: s, rows: [linkRow('Stories', urls, (u) => titleCase(lastSeg(u)))] };
    },
    signup_entry() { return { strip: strip('Screenshots', shotsOf(SHOT_KINDS.signup_entry), { itemClass: 'shot' }) }; },
    pricing() {
      const pr = prep.pricing;
      const rows = (pr?.plans ?? []).map((x) => ({ label: x.name, html: `<b>${esc(x.price)}</b>${x.unit && !/^n\/?a$/i.test(String(x.unit).trim()) && !String(x.price).includes('/') ? ` <span class="muted">${esc(x.unit)}</span>` : ''}${x.cta ? ` <span class="muted">· “${esc(x.cta)}”</span>` : ''}` }));
      return { strip: strip('Screenshots', shotsOf(['pricing']), { itemClass: 'shot' }), rows };
    },
    open_source() {
      const oss = prep.oss;
      const top = (oss?.top ?? []).filter((r) => Number.isFinite(r.stars) && safeUrl(r.url)).slice(0, 4);
      return { rows: top.length ? [
        Number.isFinite(oss.stars) ? { label: 'Stars', html: `<b>${fmtN(oss.stars)}</b> <span class="muted">across ${fmtN(oss.repos)} public repos</span>` } : null,
        { label: 'Most starred', html: top.map((r) => `${ext(r.url, r.name)} <span class="muted">${fmtN(r.stars)}★</span>`).join(' · ') },
      ] : [] };
    },
    community() {
      const c = prep.community;
      const d = c?.discord?.members > 0 ? c.discord : null;
      const hn = c?.hacker_news;
      return {
        strip: strip('Threads', postsBy((p) => ['reddit', 'hn'].includes(p.platform))),
        rows: [d ? { label: 'Discord', html: `<b>${fmtN(d.members)}</b> members <span class="muted">${fmtN(d.online)} online</span>` } : null,
          hn?.stories ? { label: 'Hacker News', html: `<b>${fmtN(hn.stories)}</b> stories link to the site` } : null],
      };
    },
    partnerships() { return { strip: strip('Screenshots', shotsOf(SHOT_KINDS.partnerships), { itemClass: 'shot' }) }; },
    video() { return { strip: strip('Videos', postsBy((p) => p.platform === 'youtube')) }; },
  };

  return (id) => {
    const b = (builders[id] ?? (() => ({})))();
    const rows = (b.rows ?? []).filter(Boolean);
    const facts = rows.length ? `<dl class="kf">${rows.map((r) => `<div><dt>${esc(r.label)}</dt><dd>${r.html}</dd></div>`).join('')}</dl>` : '';
    return { strip: b.strip ?? '', note: b.note ?? '', facts, inline: b.inline ?? '' };
  };
}

// ---------- organic social: one card per channel ----------

const compactN = (n) => {
  if (n >= 1e3) {
    const k = (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '');
    if (Number(k) < 1000) return `${k}k`; // 999,950 rounds to 1000k, which is 1M
  }
  return n >= 1e3 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : String(n);
};
// A LinkedIn slug like "michael-whittle-43735a2b" reads as a name: drop the trailing id, split on hyphens, capitalise.
// A single word ("timturner", "subsplash") is left as written.
export function personName(slug) {
  const parts = String(slug).replace(/\/+$/, '').split('-').filter(Boolean);
  if (parts.length > 1 && /^[0-9a-f]{6,}$/i.test(parts.at(-1)) && /\d/.test(parts.at(-1))) parts.pop();
  if (parts.length < 2) return String(slug);
  return parts.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}
const PMARK = { x: 'X', linkedin: 'in', instagram: 'ig', tiktok: 'tt', youtube: '▶', facebook: 'f', github: 'gh', reddit: 'r/', discord: 'dc' };

export function renderChannelCards(prep, asOf) {
  const clean = (h) => String(h).replace(/^(company|in|showcase)\//i, '').replace(/^@+/, '');
  const norm = (h) => clean(h).toLowerCase(); // for matching posts to accounts only; the card shows the handle as written
  const accounts = prep.accounts.filter((a) => safeUrl(a.url));
  if (!accounts.length) return '';
  // Group posts by the normalised handle, so "Exa" and "exa" count as one account instead of the card showing only the first spelling.
  const stats = accountStats(prep.posts.map((p) => ({ ...p, account: norm(p.account) })), { asOf });
  const order = { company: 0, founder: 1, employee: 2 };
  const cards = [...accounts].sort((a, b) => (order[a.owner] ?? 3) - (order[b.owner] ?? 3) || (b.followers ?? -1) - (a.followers ?? -1)).map((a) => {
    const s = stats.find((x) => x.platform === a.platform && norm(x.account) === norm(a.handle));
    const last = s ? prep.posts.filter((p) => p.platform === a.platform && norm(p.account) === norm(a.handle)).map((p) => p.published).sort().at(-1) : null;
    const handle = a.platform === 'linkedin' ? personName(clean(a.handle)) : `@${clean(a.handle)}`;
    const followers = Number.isFinite(a.followers) && a.followers > 0;
    const lines = [
      s ? `${s.sampled} ${s.sampled === 1 ? 'post' : 'posts'} sampled` : '',
      s?.baseline_ok ? `typical post ${fmtN(Math.round(s.median_engagement))} engagements` : s && s.measured ? `best post ${fmtN(s.top[0]?.engagement ?? 0)} engagements` : '',
      last ? `latest ${fmtDate(last, { year: false })}` : '',
    ].filter(Boolean);
    return `<a class="chan" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">
      <span class="chead"><span class="cmark cm-${esc(a.platform)}" aria-hidden="true">${esc(PMARK[a.platform] ?? '·')}</span><b class="cname">${esc(PLATFORM_LABEL[a.platform] ?? a.platform)}</b><span class="cown">${esc(a.owner === 'founder' ? 'Founder' : a.owner === 'employee' ? 'Team' : 'Company')}</span></span>
      <span class="chandle">${esc(handle)}</span>
      <span class="cnum">${followers ? `<b>${compactN(a.followers)}</b> ${a.platform === 'youtube' ? 'subscribers' : 'followers'}` : '<span class="muted">Followers not visible</span>'}</span>
      ${lines.length ? `<span class="cstats">${esc(lines.join(' · '))}</span>` : '<span class="cstats muted">No posts collected</span>'}
    </a>`;
  }).join('');
  return `<div class="chans" aria-label="Channels at a glance">${cards}</div>`;
}

// ---------- site traffic: a line chart of monthly visits (Similarweb estimates) ----------

const monthLabel = (m) => { const [y, mo] = String(m).split('-').map(Number); return `${MONTHS[mo - 1]}${mo === 1 ? ` ${y}` : ''}`; };
const compact = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));

export function renderTraffic(prep, ctx) {
  const t = prep.traffic;
  if (!t?.points?.length) return '';
  const pts = [...t.points].filter((p) => Number.isFinite(p.value) && /^\d{4}-\d{2}$/.test(p.month)).sort((a, b) => a.month.localeCompare(b.month));
  if (pts.length < 2) return '';
  const W = 640, H = 220, L = 52, R = 24, T = 24, B = 34, PAD = 18;
  const max = Math.max(...pts.map((p) => p.value));
  if (!(max > 0)) return ''; // all zeros: nothing to draw, and the scale would be NaN
  // Under about 1,000 visits a month Similarweb's estimates are mostly noise: say so instead of drawing a trend.
  if (max < 1000) {
    const it = prep.byId.get(t.evidence_id);
    return `<section id="traffic" class="block card" aria-labelledby="traffic-h"><h2 id="traffic-h">Site traffic</h2>
    <p class="tsum">Too little traffic to show a trend: ${esc(t.source ?? 'Similarweb')} estimates under 1,000 visits a month (at most ${fmtN(Math.round(max))}).</p>
    <p class="note-s">${it ? ctx.extLink(safeUrl(t.source_url) ? t.source_url : it.url, 'Source', 'Source: Similarweb traffic estimates') : ''}</p></section>`;
  }
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / step) * step;
  const x = (i) => L + PAD + (i * (W - L - R - 2 * PAD)) / (pts.length - 1);
  const y = (v) => T + (1 - v / top) * (H - T - B);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${x(pts.length - 1).toFixed(1)} ${H - B} L${x(0).toFixed(1)} ${H - B} Z`;
  const ticks = [0, 0.5, 1].map((f) => top * f);
  const grid = ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="tg"/><text x="${L - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" class="tl">${compact(v)}</text>`).join('');
  const labels = pts.map((p, i) => `<text x="${x(i).toFixed(1)}" y="${H - 10}" text-anchor="middle" class="tl">${esc(monthLabel(p.month))}</text>`).join('');
  const dots = pts.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3.5" class="td"/><text x="${x(i).toFixed(1)}" y="${(y(p.value) - 10).toFixed(1)}" text-anchor="middle" class="tv">${compact(p.value)}</text>`).join('');
  const first = pts[0], last = pts.at(-1);
  // A percentage needs a non-zero start; from zero we say so rather than print Infinity or NaN.
  const change = first.value > 0 ? Math.round(((last.value - first.value) / first.value) * 100) : null;
  const dir = change === null ? 'up from none' : change === 0 ? 'flat' : change > 0 ? `up ${change}%` : `down ${Math.abs(change)}%`;
  const summary = `${compact(last.value)} visits in ${monthLabel(last.month)}, ${dir} since ${monthLabel(first.month)}`;
  const table = `<table class="sr-only"><caption>${esc(t.label ?? 'Monthly visits')}</caption><tbody>${pts.map((p) => `<tr><th>${esc(p.month)}</th><td>${fmtN(p.value)}</td></tr>`).join('')}</tbody></table>`;
  return `<section id="traffic" class="block card" aria-labelledby="traffic-h">
    <h2 id="traffic-h">Site traffic</h2>
    <p class="tsum"><b>${esc(summary)}.</b> <span class="muted">An estimate from ${esc(t.source ?? 'Similarweb')}${t.last_updated ? `, updated ${esc(fmtDate(t.last_updated, { year: true }))}` : ''}.</span></p>
    <svg class="tchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${t.label ?? 'Monthly visits'}: ${summary}`)}">${grid}<path d="${area}" class="ta"/><path d="${line}" class="tline"/>${dots}${labels}</svg>
    ${table}
    <p class="note-s">${esc(t.label ?? 'Monthly visits')}. ${ctx.extLink(safeUrl(t.source_url) ? t.source_url : prep.byId.get(t.evidence_id).url, 'Source', 'Source: Similarweb traffic estimates')}</p>
  </section>`;
}

// ---------- tech stack ----------

export function renderTech(prep, ctx) {
  const tech = prep.tech;
  if (!tech) return '';
  const names = [...new Set(tech.tools.map((t) => t.tool))];
  const it = prep.byId.get(tech.evidence_id);
  return `<section id="tech" class="block card" aria-labelledby="tech-h">
    <h2 id="tech-h">Tech stack</h2>
    ${names.length ? `<ul class="chips">${names.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '<p class="muted">No third-party tools loaded during the visit.</p>'}
    <p class="note-s">What loaded on the homepage in a real browser visit. ${it ? ctx.extLink(it.url, 'Source', 'Source: tech stack visit') : ''}</p>
  </section>`;
}
