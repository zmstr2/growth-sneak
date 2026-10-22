// Small pure helpers shared by the renderer and its visual components.

export function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function safeUrl(u) {
  return typeof u === 'string' && /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : null;
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDate(iso, { year = true } = {}) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year ? ` ${d.getUTCFullYear()}` : ''}`;
}

export const listJoin = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
export const short = (s, n = 70) => { s = String(s ?? ''); return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s; };
export const fmtN = (n) => Number(n).toLocaleString('en-US');

export const MIN_THUMB_WIDTH = 200; // narrower "previews" are unreadable (often Google UI wrappers)
export const hasPreview = (a) => Boolean(safeUrl(a.image_url)) && (a.width == null || a.width >= MIN_THUMB_WIDTH);

// Put figures in a sentence into a quiet highlighter: $2.6M, 60,120, 97%, 7 comparison pages.
// Works on text that is already HTML-escaped, and never touches digits inside entities.
const FIG = /(?<![\w#&;.])(\$\d[\d,]*(?:\.\d+)?(?:[kKMB]\b)?|\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?(?:%|×)|\d+(?:\.\d+)?(?:\s(?:\w+\s)?(?:URLs|pages|page|followers|stars|days|ads|posts|roles|reactions|points|engagements|comparison|customer|partners|channels|repos|stories|hours?))\b)/g;
export const emphasize = (escaped) => escaped.replace(FIG, '<b class="fig">$1</b>');
