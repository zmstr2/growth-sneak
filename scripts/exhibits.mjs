// Exhibits: the proof that sits next to a claim. A post, an ad or a page screenshot, drawn from the
// evidence, never invented. Every exhibit links to its source; a post whose numbers we could not read
// says so instead of showing zero.

import { esc, fmtDate, fmtN, short, hasPreview } from './util.mjs';

export const PLATFORM_LABEL = { x: 'X', linkedin: 'LinkedIn', youtube: 'YouTube', reddit: 'Reddit', hn: 'Hacker News', instagram: 'Instagram', tiktok: 'TikTok', github: 'GitHub', discord: 'Discord' };
export const KIND_LABEL = { home: 'Homepage', pricing: 'Pricing', signup: 'Signup', customers: 'Customer story', comparison: 'Comparison page', product: 'Product page', blog: 'Blog', integrations: 'Integrations', landing: 'Landing page', other: 'Page' };

const METRIC_ORDER = {
  x: [['likes', 'likes'], ['reposts', 'reposts'], ['replies', 'replies']],
  linkedin: [['reactions', 'reactions'], ['comments', 'comments'], ['reposts', 'reposts']],
  hn: [['points', 'points'], ['comments', 'comments']],
  reddit: [['points', 'points'], ['comments', 'comments']],
  youtube: [['views', 'views']],
  instagram: [['likes', 'likes'], ['comments', 'comments'], ['views', 'views']],
  tiktok: [['views', 'views'], ['likes', 'likes'], ['comments', 'comments'], ['shares', 'shares']],
};
export function metricParts(p) {
  const m = p.metrics ?? {};
  const order = METRIC_ORDER[p.platform] ?? [['likes', 'likes'], ['comments', 'comments'], ['reposts', 'reposts'], ['reactions', 'reactions']];
  return order.filter(([k]) => Number.isFinite(m[k])).map(([k, label]) => ({ n: m[k], label }));
}

export const PLATFORM_MARK = { x: 'X', linkedin: 'in', youtube: 'YT', reddit: 'r/', hn: 'Y', instagram: 'ig', tiktok: 'tt', github: 'gh' };
export const accountLabel = (p) => (p.platform === 'linkedin' ? String(p.account).replace(/^(company|in)\//, '') : `@${String(p.account).replace(/^@+/, '')}`);

// A readable excerpt of a post.
const excerpt = (text, limit) => short(String(text ?? ''), limit);

// Small stroke icons for the metric row, so a card reads like the platform it came from.
const ICON = {
  replies: '<path d="M4 5h16v11H9l-5 4z"/>',
  comments: '<path d="M4 5h16v11H9l-5 4z"/>',
  reposts: '<path d="M5 9l3-3 3 3M8 6v9a3 3 0 0 0 3 3h2M19 15l-3 3-3-3M16 18V9a3 3 0 0 0-3-3h-2"/>',
  likes: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  reactions: '<path d="M7 11v8H4v-8zM7 11l4-7c1.5 0 2.5 1 2 3l-.5 3H19a1.5 1.5 0 0 1 1.4 2l-2 6a2 2 0 0 1-1.9 1.4H7"/>',
  views: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  points: '<path d="M12 4l7 9h-4v7H9v-7H5z"/>',
};
const icon = (k) => `<svg class="mi" viewBox="0 0 24 24" aria-hidden="true">${ICON[k] ?? ICON.likes}</svg>`;
const initials = (p) => (accountLabel(p).replace(/^@/, '').split(/[-_. ]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('') || '·').toUpperCase();

export function postCard(p, { asOfYear } = {}) {
  const parts = metricParts(p);
  const native = p.platform === 'linkedin' || p.platform === 'x';
  const nums = parts.length
    ? parts.map((x) => (native
      ? `<span class="m">${icon(x.label)}<b>${fmtN(x.n)}</b><span class="sr-only"> ${esc(x.label)}</span></span>`
      : `<span><b>${fmtN(x.n)}</b> ${esc(x.label)}</span>`)).join('')
    : '<span class="muted">Engagement not visible</span>';
  const when = fmtDate(p.published, { year: asOfYear == null || new Date(p.published).getUTCFullYear() !== asOfYear });
  const plat = PLATFORM_LABEL[p.platform] ?? p.platform;
  const who = accountLabel(p);
  const view = `<a class="ext" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open this ${esc(plat)} post">View post<span aria-hidden="true"> ↗</span></a>`;
  const body = `<blockquote>${esc(excerpt(p.text, 320))}</blockquote>`;
  if (p.platform === 'linkedin') {
    const role = p.owner === 'founder' ? 'Founder' : p.owner === 'employee' ? 'Team member' : 'Company page';
    return `<article class="xpost nat li">
    <header><span class="av" aria-hidden="true">${esc(initials(p))}</span><span class="who"><b>${esc(who)}</b><span class="sub">${esc(role)} · ${esc(when)}</span></span><span class="plat plat-li" aria-label="LinkedIn">in</span></header>
    ${body}
    <div class="xnums">${nums}</div>
    <footer><span class="acts" aria-hidden="true"><span>Like</span><span>Comment</span><span>Repost</span><span>Send</span></span>${view}</footer>
  </article>`;
  }
  if (p.platform === 'x') {
    return `<article class="xpost nat xx">
    <header><span class="av" aria-hidden="true">${esc(initials(p))}</span><span class="who"><b>${esc(String(p.account).replace(/^@+/, ''))}</b><span class="sub">${esc(who)} · ${esc(when)}</span></span><span class="plat plat-x" aria-label="X">X</span></header>
    ${body}
    <div class="xnums">${nums}</div>
    <footer>${view}</footer>
  </article>`;
  }
  const thumb = p.thumbnail_url && /^https:\/\//i.test(p.thumbnail_url)
    ? `<a class="pthumb" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open this ${esc(plat)} post"><img alt="${esc(plat)} post preview" referrerpolicy="no-referrer" loading="lazy" src="${esc(p.thumbnail_url)}"></a>` : '';
  return `<article class="xpost${thumb ? ' withthumb' : ''}">
    <header><span class="pmark pm-${esc(p.platform)}" aria-hidden="true">${esc(PLATFORM_MARK[p.platform] ?? '·')}</span><span class="xwho"><b>${esc(who)}</b><span class="muted"> · ${esc(p.owner ?? 'account')}</span></span><span class="xplat">${esc(plat)} · ${esc(when)}</span></header>
    ${thumb}${body}
    <footer><div class="xnums">${nums}</div>${view}</footer>
  </article>`;
}

// An ad from Meta, drawn the way Meta draws it: the advertiser, "Sponsored", the ad text, the creative, then the link
// block with its domain, headline and button. The creative is the real image when we have one. A video ad has no
// frame we can read, so it gets a plain panel that says so and links to the library.
const initial = (name) => esc(String(name ?? '?').trim().charAt(0).toUpperCase() || '?');
export function nativeMetaAd(a, { asOf } = {}) {
  const days = asOf && a.started_at ? Math.max(0, Math.round((Date.parse(asOf) - Date.parse(a.started_at)) / 86_400_000)) : null;
  const since = a.started_at ? fmtDate(a.started_at, { year: false }) : '';
  const name = a.advertiser ?? 'Advertiser';
  const avatar = a.avatar_src
    ? `<img class="nad-av" alt="" src="${esc(a.avatar_src)}" referrerpolicy="no-referrer" loading="lazy" width="36" height="36">`
    : `<span class="nad-av nad-ini" aria-hidden="true">${initial(name)}</span>`;
  const text = String(a.primary_text ?? a.hook_text ?? '').replace(/\s+/g, ' ').trim();
  const media = a.image_src
    ? `<a class="nad-media" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer"><img alt="${esc(`Ad creative: ${short(a.headline ?? text, 80)}`)}" src="${esc(a.image_src)}" referrerpolicy="no-referrer" loading="lazy"></a>`
    : a.is_video
      ? `<a class="nad-media nad-video" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer"><span class="nad-play" aria-hidden="true">▶</span><span>Video ad</span><span class="nad-watch">Watch on Meta<span aria-hidden="true"> ↗</span></span></a>`
      : '';
  const cta = a.cta ? String(a.cta).trim() : '';
  const desc = a.description && a.description.trim().toLowerCase() !== cta.toLowerCase() ? a.description.trim() : '';
  const link = (a.headline || a.display_link || cta)
    ? `<div class="nad-link"><span class="nad-meta">${a.display_link ? `<span class="nad-dom">${esc(short(String(a.display_link).replace(/^https?:\/\//i, ''), 40).toUpperCase())}</span>` : ''}${a.headline ? `<b>${esc(short(a.headline, 70))}</b>` : ''}${desc ? `<span class="nad-desc">${esc(short(desc, 70))}</span>` : ''}</span>${cta ? `<span class="nad-cta">${esc(cta)}</span>` : ''}</div>`
    : '';
  const cap = `<figcaption><b>${days != null ? `Running ${days} ${days === 1 ? 'day' : 'days'}` : 'Meta ad'}</b>${since ? ` · since ${esc(since)}` : ''} · <a class="ext" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">Ad Library<span aria-hidden="true"> ↗</span></a></figcaption>`;
  return `<figure class="xad nad"><div class="nad-card"><div class="nad-top">${avatar}<span class="nad-who"><b>${esc(name)}</b><span>Sponsored</span></span></div>${text ? `<p class="nad-text">${esc(text)}</p>` : ''}${media}${link}</div>${cap}</figure>`;
}

// An ad from Meta's Ad Library as Upspring describes it (estimates and a thumbnail), or a native card when the ad
// carries its own text and link block.
export function metaAdCard(a, { asOf } = {}) {
  if (a.primary_text || a.advertiser) return nativeMetaAd(a, { asOf });
  const days = asOf && a.started_at ? Math.max(0, Math.round((Date.parse(asOf) - Date.parse(a.started_at)) / 86_400_000)) : null;
  const since = a.started_at ? fmtDate(a.started_at, { year: false }) : '';
  const img = a.thumbnail_url && /^https:\/\//i.test(a.thumbnail_url);
  const body = img
    ? `<a class="thumb mthumb" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer"><img alt="${esc(a.media_type ?? 'Meta')} ad preview: ${esc(short(a.one_line ?? '', 80))}" referrerpolicy="no-referrer" loading="lazy" src="${esc(a.thumbnail_url)}"></a>`
    : `<a class="thumb textad" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer"><span>${esc(short(a.hook_text || a.one_line || 'Meta ad', 90))}</span></a>`;
  return `<figure class="xad">${body}<figcaption><b>${days != null ? `Running ${days} ${days === 1 ? 'day' : 'days'}` : 'Meta ad'}</b>${since ? ` · since ${esc(since)}` : ''}${Number.isFinite(a.impressions) ? ` · delivery strength ${a.impressions}/5` : ''}${a.hook_text ? `<span class="hl">“${esc(short(a.hook_text, 90))}”</span>` : ''}${a.one_line ? `<span class="hl">${esc(short(a.one_line, 100))}</span>` : ''}</figcaption></figure>`;
}

export function adCard(a, { asOfYear } = {}) {
  const since = a.first_shown ? fmtDate(a.first_shown, { year: String(a.first_shown).slice(0, 4) !== String(asOfYear) }) : '';
  const cap = `<figcaption><b>${a.days_shown} days</b>${since ? ` · since ${esc(since)}` : ''}${a.headline ? `<span class="hl">“${esc(short(a.headline, 90))}”</span>` : ''}</figcaption>`;
  const body = hasPreview(a)
    ? `<a class="thumb" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer"><img alt="${esc(a.format)} ad on Google, shown ${a.days_shown} days" referrerpolicy="no-referrer" loading="lazy" src="${esc(a.image_url)}"></a>`
    : `<a class="thumb textad" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer"><span>${esc(a.headline ? short(a.headline, 90) : `${a.format} ad`)}</span></a>`;
  return `<figure class="xad">${body}${cap}</figure>`;
}

export function shotFrame(s, src) {
  const host = (() => { try { const u = new URL(s.page_url); return `${u.hostname.replace(/^www\./, '')}${u.pathname === '/' ? '' : u.pathname}`; } catch { return s.page_url; } })();
  const label = KIND_LABEL[s.kind] ?? KIND_LABEL.other;
  const kind = String(s.kind ?? 'other').replace(/[^a-z]/g, '');
  const img = src ? `<img alt="Screenshot of the ${esc(label.toLowerCase())}" src="${src}">` : '<span class="noimg">Screenshot unavailable</span>';
  return `<figure class="xshot k-${kind}">
    ${src
      ? `<button class="frame" type="button" data-zoom aria-label="Enlarge the ${esc(label.toLowerCase())} screenshot"><span class="fbar" aria-hidden="true"><em>${esc(short(host, 48))}</em></span>${img}</button>`
      : `<div class="frame"><span class="fbar" aria-hidden="true"><em>${esc(short(host, 48))}</em></span>${img}</div>`}
    <figcaption><b>${esc(label)}.</b>${shortCaption(s) ? ` ${esc(shortCaption(s))}` : ''} <a class="ext" href="${esc(s.page_url)}" target="_blank" rel="noopener noreferrer" aria-label="Open the live ${esc(label.toLowerCase())}">Open page<span aria-hidden="true"> ↗</span></a></figcaption>
  </figure>`;
}

// Captions stay short: the collector's page title if it gave one, else the first clause of its caption.
export function shortCaption(s) {
  const label = KIND_LABEL[s.kind] ?? KIND_LABEL.other;
  const strip = (t) => t.replace(new RegExp(`^${label}( page| headline)*[.:,\\s-]*`, 'i'), '').trim();
  if (s.title) return short(strip(String(s.title)), 80);
  const body = strip(String(s.caption ?? '').replace(/\s+/g, ' ').trim());
  const out = body.split(/\.\s|;|:\s|\s\(/)[0].trim();
  return out.length >= 8 ? short(out, 80) : '';
}
