// The free scripts (sitemap, sitecheck, social) already write exact data to raw/. Collectors used to copy those
// numbers into their fragments by hand; this builds the blocks straight from the files instead.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fmtN } from '../util.mjs';

const read = (dir, f) => { const p = join(dir, 'raw', f); if (!existsSync(p)) return null; try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const SOCIAL = ['x', 'linkedin', 'youtube', 'instagram', 'tiktok'];

export function extractScripts(dir, ctx) {
  const owned = { layer: 'owned', items: [] }; const social = { layer: 'social', items: [], accounts: [] };
  const site = read(dir, 'sitemap.json');
  if (site && Number.isFinite(site.total_urls) && Array.isArray(site.sections)) {
    const top = [...site.sections].sort((a, b) => b.urls - a.urls).slice(0, 3).map((s) => `${s.path} (${fmtN(s.urls)})`);
    owned.items.push({ ref: 'auto-site', channel: 'seo_content', status: 'observed', finding: `The sitemaps list ${fmtN(site.total_urls)} pages${top.length ? `; the largest sections are ${top.join(', ')}` : ''}.`, url: `https://${ctx.domain}/sitemap.xml`, raw_ref: 'raw/sitemap.json' });
    owned.site = {
      total_urls: site.total_urls, locales: Array.isArray(site.locales) ? site.locales.length : (site.locales ?? 0), sitemaps_read: site.sitemaps_read, as_of: site.as_of, sections: site.sections,
      ...(site.page_types ? { page_types: site.page_types } : {}), ...(site.by_month ? { by_month: site.by_month } : {}), evidence_ref: 'auto-site', raw_ref: 'raw/sitemap.json',
    };
  }
  const checks = read(dir, 'sitecheck.json');
  if (checks && Array.isArray(checks.checks) && checks.checks.length) {
    owned.items.push({ ref: 'auto-sitechecks', channel: 'ai_search', status: 'observed', finding: `Site checks: ${checks.checks.map((c) => `${c.check}: ${c.result}`).join('; ')}.`, url: `https://${ctx.domain}/`, raw_ref: 'raw/sitecheck.json' });
    owned.site_checks = { checks: checks.checks, evidence_ref: 'auto-sitechecks', raw_ref: 'raw/sitecheck.json' };
  }
  const s = read(dir, 'social.json');
  if (s) {
    const home = s.homepage && /^https?:\/\//.test(s.homepage) ? s.homepage : `https://${ctx.domain}/`;
    const accts = (s.accounts ?? []).filter((a) => SOCIAL.includes(a.platform) && /^https?:\/\//.test(a.url ?? ''));
    if (accts.length) {
      social.items.push({ ref: 'auto-accounts', channel: 'social', status: 'observed', finding: `The company's own site links to ${accts.length} social account${accts.length === 1 ? '' : 's'}: ${accts.map((a) => `${a.platform} (${a.handle})`).join(', ')}.`, url: home, raw_ref: 'raw/social.json' });
      social.accounts = accts.map((a) => ({ platform: a.platform, handle: a.handle, url: a.url, owner: 'company', followers: null, evidence_ref: 'auto-accounts', raw_ref: 'raw/social.json' }));
    }
    const g = s.github;
    if (g && g.org && Array.isArray(g.top)) {
      const t = g.top.slice(0, 2).map((r) => `${r.name} has ${fmtN(r.stars)}`).join(' and ');
      social.items.push({ ref: 'auto-oss', channel: 'open_source', status: 'observed', finding: `GitHub org ${g.org}: ${g.repos} public repos with ${fmtN(g.stars)} stars${t ? `; ${t}` : ''}.`, url: `https://github.com/${g.org}`, raw_ref: 'raw/social.json' });
      social.oss = { org: g.org, url: `https://github.com/${g.org}`, repos: g.repos, stars: g.stars, top: g.top, evidence_ref: 'auto-oss', raw_ref: 'raw/social.json' };
    }
    social.community = {};
    const d = s.discord;
    if (d && d.name && Number.isFinite(d.members)) {
      social.items.push({ ref: 'auto-discord', channel: 'community', status: 'observed', finding: `Discord server "${d.name}" has ${fmtN(d.members)} members${Number.isFinite(d.online) ? ` (${d.online} online when checked)` : ''}.`, url: `https://discord.gg/${d.invite}`, raw_ref: 'raw/social.json' });
      social.community.discord = { ...d, evidence_ref: 'auto-discord', raw_ref: 'raw/social.json' };
    }
    const h = s.hacker_news;
    if (h && Number.isFinite(h.stories) && h.stories > 0 && h.top?.[0]?.hn_url) {
      social.items.push({ ref: 'auto-hn', channel: 'community', status: 'observed', finding: `${h.stories} Hacker News stor${h.stories === 1 ? 'y links' : 'ies link'} to ${ctx.domain}; the highest scored ${h.top[0].points} points ("${h.top[0].title}").`, url: h.top[0].hn_url, raw_ref: 'raw/social.json' });
      social.community.hacker_news = { stories: h.stories, top: h.top, evidence_ref: 'auto-hn', raw_ref: 'raw/social.json' };
    }
    if (!Object.keys(social.community).length) delete social.community;
  }
  return [owned, social].filter((f) => f.items.length);
}
