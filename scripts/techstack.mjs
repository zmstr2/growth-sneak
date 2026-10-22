// Tech-stack classification from what a rendered page actually loaded.
// Input comes from a browser visit (the collector runs a small script in the page that returns
// the hostnames of every loaded resource, the script hosts and a list of known globals).
// Raw HTML is not enough: many sites inject their tags after the page starts.

export const CATEGORIES = [
  'Advertising pixels', 'Visitor identification', 'Analytics', 'Experimentation', 'Marketing automation',
  'Affiliate & referral', 'Chat & sales', 'Consent', 'Monitoring', 'Content & media', 'Sign-in & payments',
];

// [pattern on hostname, tool, category]
const HOSTS = [
  [/googletagmanager\.com$/, 'Google Tag Manager', 'Analytics'],
  [/google-analytics\.com$|analytics\.google\.com$/, 'Google Analytics', 'Analytics'],
  [/doubleclick\.net$|googleadservices\.com$|googlesyndication\.com$/, 'Google Ads', 'Advertising pixels'],
  [/connect\.facebook\.net$|(^|\.)facebook\.com$/, 'Meta Pixel', 'Advertising pixels'],
  [/snap\.licdn\.com$|px\.ads\.linkedin\.com$/, 'LinkedIn Insight Tag', 'Advertising pixels'],
  [/analytics\.tiktok\.com$/, 'TikTok Pixel', 'Advertising pixels'],
  [/bat\.bing\.com$/, 'Microsoft Ads', 'Advertising pixels'],
  [/redditstatic\.com$|alb\.reddit\.com$/, 'Reddit Pixel', 'Advertising pixels'],
  [/static\.ads-twitter\.com$|analytics\.twitter\.com$/, 'X (Twitter) Pixel', 'Advertising pixels'],
  [/segment\.(com|io)$/, 'Segment', 'Analytics'],
  [/amplitude\.com$/, 'Amplitude', 'Analytics'],
  [/mixpanel\.com$/, 'Mixpanel', 'Analytics'],
  [/posthog\.com$/, 'PostHog', 'Analytics'],
  [/heapanalytics\.com$|heap-api\.com$/, 'Heap', 'Analytics'],
  [/fullstory\.com$/, 'FullStory', 'Analytics'],
  [/hotjar\.(com|io)$/, 'Hotjar', 'Analytics'],
  [/clarity\.ms$/, 'Microsoft Clarity', 'Analytics'],
  [/cloudflareinsights\.com$/, 'Cloudflare Web Analytics', 'Analytics'],
  [/vercel-insights\.com$|vitals\.vercel/, 'Vercel Analytics', 'Analytics'],
  [/optimizely\.com$/, 'Optimizely', 'Experimentation'],
  [/statsig(api)?\.(com|net)$|featuregates\.org$/, 'Statsig', 'Experimentation'],
  [/launchdarkly\.com$/, 'LaunchDarkly', 'Experimentation'],
  [/visualwebsiteoptimizer\.com$/, 'VWO', 'Experimentation'],
  [/hs-scripts\.com$|hs-analytics\.net$|hs-banner\.com$|hscollectedforms\.net$|hubspot\.com$|hsforms\.(com|net)$/, 'HubSpot', 'Marketing automation'],
  [/marketo\.(com|net)$|mktoresp\.com$/, 'Marketo', 'Marketing automation'],
  [/6sc\.co$|6sense\.com$/, '6sense', 'Marketing automation'],
  [/clearbit\.com$|clearbitscripts\.com$/, 'Clearbit', 'Marketing automation'],
  [/zoominfo\.com$/, 'ZoomInfo', 'Visitor identification'],
  [/rb2b\.com$|reb2b\.js|ddwl4m2hdecbv\.cloudfront\.net$/, 'RB2B', 'Visitor identification'],
  [/cr-relay\.com$|commonroom\.io$/, 'Common Room', 'Visitor identification'],
  [/warmly\.ai$/, 'Warmly', 'Visitor identification'],
  [/getkoala\.com$/, 'Koala', 'Visitor identification'],
  [/(^|\.)default\.com$/, 'Default', 'Chat & sales'],
  [/tolt\.io$/, 'Tolt', 'Affiliate & referral'],
  [/rewardful\.com$/, 'Rewardful', 'Affiliate & referral'],
  [/firstpromoter\.com$/, 'FirstPromoter', 'Affiliate & referral'],
  [/partnerstack\.com$/, 'PartnerStack', 'Affiliate & referral'],
  [/impact\.com$|impactradius-event\.com$/, 'impact.com', 'Affiliate & referral'],
  [/intercom(cdn)?\.(io|com)$/, 'Intercom', 'Chat & sales'],
  [/drift\.com$|driftt\.com$/, 'Drift', 'Chat & sales'],
  [/qualified\.com$/, 'Qualified', 'Chat & sales'],
  [/chilipiper\.com$/, 'Chili Piper', 'Chat & sales'],
  [/calendly\.com$/, 'Calendly', 'Chat & sales'],
  [/transcend-cdn\.com$|transcend\.io$/, 'Transcend', 'Consent'],
  [/onetrust\.com$|cookielaw\.org$/, 'OneTrust', 'Consent'],
  [/cookiebot\.com$/, 'Cookiebot', 'Consent'],
  [/osano\.com$/, 'Osano', 'Consent'],
  [/sentry\.io$|sentry-cdn\.com$/, 'Sentry', 'Monitoring'],
  [/datadoghq\.(com|eu)$/, 'Datadog', 'Monitoring'],
  [/splunkcloud\.com$/, 'Splunk', 'Monitoring'],
  [/ctfassets\.net$|contentful\.com$/, 'Contentful', 'Content & media'],
  [/sanity\.io$/, 'Sanity', 'Content & media'],
  [/wistia\.(com|net)$/, 'Wistia', 'Content & media'],
  [/vimeo(cdn)?\.com$/, 'Vimeo', 'Content & media'],
  [/youtube\.com$|ytimg\.com$/, 'YouTube embeds', 'Content & media'],
  [/accounts\.google\.com$/, 'Google sign-in', 'Sign-in & payments'],
  [/js\.stripe\.com$/, 'Stripe', 'Sign-in & payments'],
];

const GLOBALS = {
  fbq: ['Meta Pixel', 'Advertising pixels'], lintrk: ['LinkedIn Insight Tag', 'Advertising pixels'],
  _linkedin_partner_id: ['LinkedIn Insight Tag', 'Advertising pixels'], ttq: ['TikTok Pixel', 'Advertising pixels'],
  uetq: ['Microsoft Ads', 'Advertising pixels'], rdt: ['Reddit Pixel', 'Advertising pixels'], twq: ['X (Twitter) Pixel', 'Advertising pixels'],
  gtag: ['Google tag', 'Analytics'], amplitude: ['Amplitude', 'Analytics'], mixpanel: ['Mixpanel', 'Analytics'],
  posthog: ['PostHog', 'Analytics'], heap: ['Heap', 'Analytics'], hj: ['Hotjar', 'Analytics'], clarity: ['Microsoft Clarity', 'Analytics'],
  Statsig: ['Statsig', 'Experimentation'], optimizely: ['Optimizely', 'Experimentation'], ldclient: ['LaunchDarkly', 'Experimentation'],
  hbspt: ['HubSpot', 'Marketing automation'], reb2b: ['RB2B', 'Visitor identification'], rb2b: ['RB2B', 'Visitor identification'], Marketo: ['Marketo', 'Marketing automation'], _6si: ['6sense', 'Marketing automation'],
  Intercom: ['Intercom', 'Chat & sales'], drift: ['Drift', 'Chat & sales'], qualified: ['Qualified', 'Chat & sales'], ChiliPiper: ['Chili Piper', 'Chat & sales'],
  transcend: ['Transcend', 'Consent'], OneTrust: ['OneTrust', 'Consent'], Cookiebot: ['Cookiebot', 'Consent'], Osano: ['Osano', 'Consent'],
  Sentry: ['Sentry', 'Monitoring'], DD_RUM: ['Datadog', 'Monitoring'],
};

/**
 * @param {{hosts?: Record<string, number>|string[], scriptHosts?: string[], globals?: string[]}} seen
 * @param {string} domain the company's own domain; its hosts are first-party and not classified
 */
// Pull the page's resource summary out of whatever the collector saved: the parsed object, a JSON string,
// or the whole Firecrawl scrape result (actions.javascriptReturns[0].value holds the JSON string).
export function extractSeen(input) {
  let v = input;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { throw new Error('techstack: input is a string that is not JSON'); } }
  const fromScrape = v?.actions?.javascriptReturns ?? v?.data?.actions?.javascriptReturns;
  if (fromScrape?.length) {
    const raw = fromScrape.map((r) => r.value ?? r).find((x) => typeof x === 'string' && x.includes('hosts'));
    if (raw) v = JSON.parse(raw);
  }
  if (!v || (v.hosts == null && v.scriptHosts == null && v.globals == null)) {
    throw new Error('techstack: expected an object with "hosts", "scriptHosts" and "globals" (or a Firecrawl scrape result that contains one)');
  }
  return v;
}

const NOISE = /(^|\.)(google\.com|gstatic\.com|googleapis\.com|cloudfront\.net|amazonaws\.com|imgix\.net|cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com)$/;

export function classify(input, domain) {
  const seen = extractSeen(input);
  const root = String(domain).replace(/^www\./, '');
  const hostList = [...new Set([...(Array.isArray(seen.hosts) ? seen.hosts : Object.keys(seen.hosts ?? {})), ...(seen.scriptHosts ?? [])])]
    .map((h) => String(h).toLowerCase()).filter(Boolean);
  const tools = new Map();
  const add = (tool, category, via) => {
    if (!tools.has(tool)) tools.set(tool, { tool, category, via: [] });
    if (!tools.get(tool).via.includes(via)) tools.get(tool).via.push(via);
  };
  const unknown = [];
  for (const h of hostList) {
    if (h === root || h.endsWith(`.${root}`)) continue;
    const hit = HOSTS.find(([re]) => re.test(h));
    if (hit) add(hit[1], hit[2], h); else if (!NOISE.test(h)) unknown.push(h);
  }
  for (const g of seen.globals ?? []) if (GLOBALS[g]) add(GLOBALS[g][0], GLOBALS[g][1], `window.${g}`);

  const list = [...tools.values()].sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || a.tool.localeCompare(b.tool));
  const hasConsent = list.some((t) => t.category === 'Consent');
  const notes = [];
  const pixels = list.filter((t) => t.category === 'Advertising pixels');
  if (list.some((t) => t.category === 'Visitor identification')) {
    notes.push('Runs visitor-identification tools, which name the companies (or people) visiting the site so sales can follow up.');
  }
  if (list.some((t) => t.category === 'Affiliate & referral')) {
    notes.push('Loads an affiliate or referral platform, so partners are likely paid for referrals.');
  }
  if (!pixels.length) {
    notes.push(hasConsent
      ? 'No advertising pixels loaded during a visit without clicking the cookie banner. A consent manager is present, so pixels may only load after consent.'
      : 'No advertising pixels loaded during the visit.');
  }
  if ((seen.globals ?? []).includes('dataLayer') && !list.some((t) => t.tool === 'Google Tag Manager')) {
    notes.push('A Google-style data layer exists but no tag manager loaded during the visit.');
  }
  return { tools: list, unknown_hosts: unknown.sort(), notes };
}

import { fileURLToPath } from 'node:url';
import { isMain } from './ismain.mjs';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
if (isMain(import.meta.url)) {
  const [file, domain] = process.argv.slice(2);
  if (!file || !domain) { console.error('usage: node scripts/techstack.mjs <visit.json> <domain>'); process.exit(2); }
  try { console.log(JSON.stringify(classify(readFileSync(file, 'utf8'), domain), null, 2)); }
  catch (e) { console.error(`error: ${e.message}`); process.exit(1); }
}
