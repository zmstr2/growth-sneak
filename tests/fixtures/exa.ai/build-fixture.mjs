// Builds tests/fixtures/exa.ai/{evidence,analysis}.json from real collector outputs in ./raw.
//
//   node tests/fixtures/exa.ai/build-fixture.mjs
//
// Sources (all collected 2026-10-20):
//   raw/sitemap.json     scripts/sitemap.mjs exa.ai
//   raw/sitecheck.json   scripts/sitecheck.mjs exa.ai
//   raw/social.json      scripts/social.mjs exa.ai (accounts from the homepage, GitHub, Discord, Hacker News)
//   raw/tech-visit.json  Firecrawl rendered visit (resource hosts and globals)
//   raw/pricing.json     Firecrawl JSON extraction of /pricing
//   raw/x-posts.json     Firecrawl Alexandria x-com/users/posts (10-post sample per account)
//   raw/li-posts.json    Exa search (company page with recent LinkedIn posts and reaction counts)
//   ADS below            Firecrawl Alexandria adstransparency-google-com list_ads (40 most recently shown)
//   HEADLINES below      read from the ad creative images
//
// This file is the analyst's work for the sample: the analysis block is written the way the
// sneak-analyst agent is instructed to write it (describe, cite, no recommendations).

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify } from '../../../scripts/techstack.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const raw = (f) => JSON.parse(readFileSync(join(HERE, 'raw', f), 'utf8'));
const site = raw('sitemap.json');
const checks = raw('sitecheck.json');
const social = raw('social.json');
const tech = classify(raw('tech-visit.json'), 'exa.ai');
const pricing = raw('pricing.json');
const xPosts = raw('x-posts.json').posts;
const liPosts = raw('li-posts.json').posts;

const CAP = '2026-10-20T19:00:00Z';
const ADV = 'AR12348457191374585857';
const T = 'text', I = 'image';
// [creative_id, format, days_shown, first_shown, last_shown, simgad id|null, width, height]
const ADS = [
  ['CR05207196402387517441', T, 8, '2026-10-12', '2026-10-20', '12213449700824397029', 364, 233],
  ['CR12180661984580075521', T, 5, '2026-10-15', '2026-10-20', '16235185773347886515', 364, 213],
  ['CR09027842628502159361', T, 19, '2026-10-01', '2026-10-20', '12817324950978413230', 348, 347],
  ['CR04769995394811691009', T, 8, '2026-10-12', '2026-10-20', '15353894857311060680', 348, 180],
  ['CR07268735624490778625', T, 19, '2026-10-01', '2026-10-20', '16548195619122876460', 348, 130],
  ['CR16252723089257791489', T, 8, '2026-10-12', '2026-10-20', '15748304818374996168', 360, 253],
  ['CR01722366865918918657', T, 8, '2026-10-12', '2026-10-20', '12795356856125560522', 348, 341],
  ['CR03676937900290736129', T, 8, '2026-10-12', '2026-10-20', '3839293928863940999', 348, 134],
  ['CR07782326301917970433', T, 19, '2026-10-01', '2026-10-20', '5467743384005190050', 348, 240],
  ['CR17227208700083568641', T, 19, '2026-10-01', '2026-10-20', '11852186235601260926', 364, 213],
  ['CR10710791959615635457', T, 19, '2026-10-01', '2026-10-20', '13452386588258600310', 348, 483],
  ['CR11429806593483472897', T, 19, '2026-10-01', '2026-10-20', '16207425437768230400', 364, 207],
  ['CR08402973128006828033', T, 8, '2026-10-12', '2026-10-20', '5568413641395471582', 348, 160],
  ['CR09928854474313433089', T, 19, '2026-10-01', '2026-10-20', '17270638736805267167', 348, 378],
  ['CR08774626749892788225', T, 19, '2026-10-01', '2026-10-20', '11930950486406469197', 348, 130],
  ['CR18137162873963544577', T, 8, '2026-10-13', '2026-10-20', '4717662758257161759', 348, 134],
  ['CR07314669921764376577', T, 8, '2026-10-13', '2026-10-20', '14179224858780448165', 348, 468],
  ['CR04314540295191527425', T, 8, '2026-10-13', '2026-10-20', '3134711309294601285', 348, 134],
  ['CR17827605270767861761', T, 19, '2026-10-01', '2026-10-20', '1007420867746305149', 348, 266],
  ['CR04286799616822738945', T, 8, '2026-10-13', '2026-10-20', null, null, null],
  ['CR12434248948363821057', T, 8, '2026-10-13', '2026-10-19', '7826414821189068322', 348, 134],
  ['CR00549614019837689857', T, 19, '2026-10-01', '2026-10-19', '5124729012118014262', 348, 246],
  ['CR11993030222220886017', T, 35, '2026-08-29', '2026-10-01', '13531725712697227286', 364, 207],
  ['CR06998245215618203649', T, 34, '2026-08-29', '2026-10-01', '4415093677386125178', 364, 213],
  ['CR04491250952149401601', T, 35, '2026-08-29', '2026-10-01', '5457016567940682206', 348, 180],
  ['CR03577869050769833985', T, 34, '2026-08-29', '2026-10-01', '16718091162248477406', 348, 134],
  ['CR06605712967432404993', T, 35, '2026-08-29', '2026-10-01', '9121947743853722659', 348, 370],
  ['CR04273362562529099777', T, 317, '2025-07-30', '2026-10-01', '12457373142807659404', 348, 431],
  ['CR14246313801078013953', T, 321, '2025-07-29', '2026-10-01', '15845568189462724410', 348, 451],
  ['CR03918913471529353217', T, 35, '2026-08-29', '2026-10-01', '14002705887044016630', 348, 410],
  ['CR14927447991626235905', T, 308, '2025-08-10', '2026-09-30', '1500311092202207551', 381, 306],
  ['CR12605594581283635201', T, 274, '2025-07-30', '2026-08-29', '11122517389632241563', 400, 400],
  ['CR04068986990425538561', T, 179, '2025-07-30', '2026-08-21', '8625068776497201153', 380, 248],
  ['CR06024811631261777921', T, 102, '2025-08-10', '2026-02-13', '8722357958860271272', 348, 133],
  ['CR06006583145812459521', T, 239, '2025-05-06', '2025-12-31', '183302362883853164', 380, 505],
  ['CR08871025272216879105', T, 3, '2025-11-25', '2025-11-27', '11154369891828505095', 400, 400],
  ['CR01633327254660448257', T, 3, '2025-11-25', '2025-11-27', '14180787114030910817', 400, 400],
  ['CR00491889874127814657', I, 31, '2025-10-20', '2025-11-25', '10553138224026774080', 724, 511],
  ['CR04555658462108844033', T, 31, '2025-10-23', '2025-11-25', '9456311274819120266', 381, 260],
  ['CR02211183012341612545', I, 31, '2025-10-20', '2025-11-25', '2221163522667231284', 724, 423],
];
// Read from the creative images (text verbatim).
const HEADLINES = {
  CR14246313801078013953: 'AI Search Engine - AI-Powered Web Search',
  CR04273362562529099777: 'AI-Powered Search API - Faster Web Crawling API (sitelink: Exa vs Brave vs Perplexity)',
  CR14927447991626235905: 'People Search API - Phone Number Lookup API',
  CR12605594581283635201: 'Web Search API for LLMs - LLM Search + Retrieval API',
  CR05207196402387517441: "Exa Official Site - Exa Pricing and Plans - The World's Data for AI",
  CR12180661984580075521: 'Deep Research API - One API, Full Research Loop',
  CR09027842628502159361: 'Deep Research API',
  CR04769995394811691009: 'An API, Not a Search Engine - Deep Search API for LLMs',
  CR00491889874127814657: 'Websets: 50+ sources for leads in one tool',
};
const adUrl = (cid) => `https://adstransparency.google.com/advertiser/${ADV}/creative/${cid}?region=anywhere`;
const ads = ADS.map(([cid, format, days, first, last, sim, w, h], i) => ({
  id: `AD${String(i + 1).padStart(3, '0')}`,
  platform: 'google', format, days_shown: days, first_shown: first, last_shown: last,
  image_url: sim ? `https://tpc.googlesyndication.com/archive/simgad/${sim}` : null,
  width: w, height: h, url: adUrl(cid),
  ...(HEADLINES[cid] ? { headline: HEADLINES[cid] } : {}),
}));

// ---- facts computed from the data ----
const running = ads.filter((a) => a.last_shown >= '2026-10-18');
const startedOct = ads.filter((a) => a.first_shown >= '2026-10-01');
const longRun = ads.filter((a) => a.days_shown >= 270);
const sec = (p) => site.sections.find((s) => s.path === p);
const check = (name) => checks.checks.find((c) => c.check === name);
const gh = social.github;
const dc = social.discord;
const hn = social.hacker_news;

const ADV_URL = `https://adstransparency.google.com/advertiser/${ADV}?region=anywhere`;
const xUrl = (a, id) => `https://x.com/${a}/status/${id}`;
const item = (id, collector, channel, status, finding, url, extra = {}) => ({ id, collector, channel, status, finding, url, captured_at: CAP, ...extra });
const snapshot = liPosts.find((p) => p.paid);

const items = [
  item('E001', 'paid', 'google_ads', 'observed', `Google's Ads Transparency Center lists 52 ads for exa.ai (all regions).`, ADV_URL),
  item('E002', 'paid', 'google_ads', 'observed', `Of the ${ads.length} most recently shown ads, ${running.length} are running now; ${ads.filter((a) => a.format === 'text').length} are search (text) ads and ${ads.filter((a) => a.format === 'image').length} are image ads.`, ADV_URL),
  item('E003', 'paid', 'google_ads', 'observed', `${longRun.length} search ads ran ${Math.min(...longRun.map((a) => a.days_shown))}-${Math.max(...longRun.map((a) => a.days_shown))} days from mid-2025 until about 1 Oct 2026, when a new batch began: ${startedOct.length} ads started between 1 and 15 Oct 2026.`, ADV_URL),
  item('E004', 'paid', 'google_ads', 'observed', 'Search-ad headlines target category and use-case searches: "AI Search Engine", "Web Search API for LLMs", "People Search API - Phone Number Lookup API", "Deep Research API" and "An API, Not a Search Engine ... From $4/1k". One carries an "Exa vs Brave vs Perplexity" sitelink.', adUrl('CR14246313801078013953')),
  item('E005', 'paid', 'google_ads', 'observed', 'A brand search ad ("Exa Official Site - Exa Pricing and Plans") says the API is "Used in production at Cursor, Cognition, HubSpot and monday.com".', adUrl('CR05207196402387517441')),
  item('E006', 'paid', 'meta_ads', 'couldnt_check', 'Meta ad data was not collected in this run. Use the library link to look.', 'https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&q=exa&search_type=keyword_unordered'),
  item('E007', 'paid', 'linkedin_ads', 'observed', `The Exa Snapshot launch post on LinkedIn (17 Sep) links with utm_medium=paid and a "Multiply-ThoughtLeadership" campaign tag, so it was promoted as a paid post.`, snapshot.url),
  item('E008', 'paid', 'tiktok_ads', 'couldnt_check', 'TikTok ads are link-only: the library mostly covers EU delivery, so we did not look.', 'https://library.tiktok.com/ads?region=all&adv_name=exa'),
  item('E009', 'owned', 'pricing_signup', 'observed', 'Three plans: Starter (free, $10 of credits a month), Developer (pay as you go) and Enterprise (custom, "Talk to sales"). Search is priced from $4 per 1,000 requests.', 'https://exa.ai/pricing', { image: 'assets/pricing.jpg', funnel_step: 'pricing' }),
  item('E010', 'owned', 'pricing_signup', 'observed', 'Headline "The world\'s data for AI agents" with one main button, "Try API for free", which goes straight to the dashboard.', 'https://exa.ai/', { image: 'assets/home.jpg', funnel_step: 'home' }),
  item('E011', 'owned', 'seo_content', 'observed', `The sitemaps list ${site.total_urls} pages: ${sec('/docs').urls} docs pages, ${sec('/blog').urls} blog pages (${sec('/blog').updated_90d} updated in the last 90 days) and a ${sec('/library').urls}-page data library.`, 'https://exa.ai/sitemap.xml'),
  item('E012', 'owned', 'comparison', 'observed', `${sec('/versus').urls} "versus" pages and ${sec('/alternatives').urls} "alternatives" pages (for example Brave Search API alternatives); ${sec('/alternatives').updated_90d} of the ${sec('/alternatives').urls} alternatives pages were updated in the last 90 days.`, 'https://exa.ai/alternatives/brave-search-api'),
  item('E013', 'owned', 'integrations', 'observed', `${sec('/integrations').urls} integration pages in the sitemap.`, 'https://exa.ai/integrations'),
  item('E014', 'owned', 'ai_search', 'observed', `Publishes an llms.txt (${check('llms.txt').detail.replace(/^Published \(|\)$/g, '')}) and lets every major AI crawler in, including Meta's and Amazon's. Homepage structured data: ${check('Structured data (JSON-LD)').detail}.`, 'https://exa.ai/llms.txt'),
  item('E015', 'earned', 'social', 'observed', 'A 10-post sample of @ExaAILabs on X (8-19 Oct 2026), with likes, reposts and replies.', 'https://x.com/ExaAILabs'),
  item('E016', 'earned', 'founder_social', 'observed', 'A 9-post sample of CEO Will Bryk (@WilliamBryk) on X (6-19 Oct 2026), with likes, reposts and replies.', 'https://x.com/WilliamBryk'),
  item('E017', 'earned', 'social', 'observed', `${liPosts.length} LinkedIn posts from the Exa company page (14 Aug - 12 Oct 2026) with reaction counts, found through Exa search.`, 'https://www.linkedin.com/company/exa-ai/'),
  item('E018', 'earned', 'founder_social', 'stated', 'The CEO says Exa "just passed $100m in annualized revenue", has "grown almost exactly 10x per year for 3 years" and handles "2 billion requests a month from 200k+ teams".', xUrl('WilliamBryk', '2110058915589464192')),
  item('E019', 'earned', 'open_source', 'observed', `GitHub org exa-labs: ${gh.repos} public repos with ${gh.stars.toLocaleString('en-US')} stars; ${gh.top[0].name} has ${gh.top[0].stars.toLocaleString('en-US')} and ${gh.top[1].name} has ${gh.top[1].stars.toLocaleString('en-US')}.`, 'https://github.com/exa-labs'),
  item('E020', 'earned', 'community', 'observed', `Discord server "${dc.name}" has ${dc.members.toLocaleString('en-US')} members (${dc.online} online when checked).`, 'https://discord.gg/HCShtBqbfV'),
  item('E021', 'earned', 'community', 'observed', `${hn.stories} Hacker News stories link to exa.ai; the highest scored ${hn.top[0].points} points ("${hn.top[0].title}").`, hn.top[0].hn_url),
  item('E022', 'earned', 'community', 'couldnt_check', 'Reddit search was blocked (HTTP 403), so Reddit activity is unknown.', 'https://www.reddit.com/search/?q=exa.ai'),
  item('E023', 'earned', 'events', 'observed', 'LinkedIn promotes a steady run of events: a Crunchbase webinar (12 Oct), a "GTM On the Edge" meetup in SF (7 Oct), an Aaru webinar (1 Oct) and a Gemini hack lab (Aug). The sitemap has 5 webinar pages.', liPosts[0].url),
  item('E024', 'earned', 'partnerships', 'observed', 'Partnership launches on LinkedIn: Vercel marketplace and AI Gateway (26 Aug), an Exa plugin in Codex and ChatGPT (20 Aug), and Firefox\'s AI window (18 Aug). The pricing page lists an MCP server, a Claude Connector and a ChatGPT plugin.', liPosts.find((p) => /Vercel/.test(p.text)).url),
  item('E025', 'earned', 'referral', 'observed', 'The homepage loads Tolt, an affiliate and referral platform.', 'https://exa.ai/'),
  item('E026', 'company', 'martech', 'observed', `A rendered visit of the homepage loaded ${tech.tools.map((t) => t.tool).join(', ')}.`, 'https://exa.ai/'),
  item('E027', 'company', 'hiring', 'observed', 'Hiring posts on LinkedIn (Head of Security, 3 Sep) and from staff ("Product team at Exa is hiring", 14 Oct).', liPosts.find((p) => p.kind === 'hiring').url),
  item('E028', 'earned', 'press_podcasts', 'observed', 'Exa promoted an interview with 3Blue1Brown on its research vision (9 Oct).', xUrl('ExaAILabs', '2108597265317450154')),
  item('E029', 'earned', 'video', 'couldnt_check', 'YouTube was not collected in this run.', 'https://exa.ai/'),
  item('E030', 'earned', 'reviews', 'couldnt_check', 'Review sites were not collected in this run.', 'https://exa.ai/'),
  item('E031', 'earned', 'founder_social', 'observed', 'Will Bryk\'s LinkedIn profile shows 11,547 followers.', 'https://www.linkedin.com/in/william-bryk'),
];

const posts = [
  ...xPosts.map((p) => ({
    id: `X${p.id}`, platform: 'x', account: p.account, owner: p.owner, url: xUrl(p.account, p.id),
    published: p.created_at.slice(0, 10), text: p.text,
    metrics: { likes: p.likes, reposts: p.reposts, replies: p.replies },
    evidence_id: p.owner === 'founder' ? 'E016' : 'E015',
  })),
  ...liPosts.map((p, i) => ({
    id: `LI${i + 1}`, platform: 'linkedin', account: p.account, owner: p.owner, url: p.url,
    published: p.created_at, text: p.text, kind: p.kind, paid: Boolean(p.paid),
    metrics: { reactions: p.reactions, ...(p.comments != null ? { comments: p.comments } : {}) },
    evidence_id: 'E017',
  })),
];

const evidence = {
  domain: 'exa.ai',
  captured_at: CAP,
  note: 'SAMPLE RUN on exa.ai. X posts are a 10-post sample per account and LinkedIn posts come from search, not a full export. Reddit was blocked; Meta, TikTok, YouTube and reviews were not collected.',
  sources: { firecrawl: 'connected', exa: 'connected', jev: 'missing', clay: 'missing', apify: 'missing' },
  cost: { firecrawl_credits: 76, note: 'ads 5, pricing 5, homepage 5, X samples 60, docs 1; sitemaps, robots.txt, GitHub, Discord and Hacker News are free' },
  items,
  ads,
  ads_total: { low: 52, high: 52 },
  posts,
  accounts: [
    { platform: 'x', handle: 'ExaAILabs', url: 'https://x.com/ExaAILabs', owner: 'company', followers: null, evidence_id: 'E015' },
    { platform: 'x', handle: 'WilliamBryk', url: 'https://x.com/WilliamBryk', owner: 'founder', followers: null, evidence_id: 'E016' },
    { platform: 'linkedin', handle: 'company/exa-ai', url: 'https://www.linkedin.com/company/exa-ai/', owner: 'company', followers: null, evidence_id: 'E017' },
    { platform: 'linkedin', handle: 'in/william-bryk', url: 'https://www.linkedin.com/in/william-bryk', owner: 'founder', followers: 11547, evidence_id: 'E031' },
  ],
  oss: { evidence_id: 'E019', org: gh.org, url: 'https://github.com/exa-labs', repos: gh.repos, stars: gh.stars, top: gh.top },
  community: {
    discord: { evidence_id: 'E020', ...dc },
    hacker_news: { evidence_id: 'E021', stories: hn.stories, top: hn.top },
  },
  site: { evidence_id: 'E011', total_urls: site.total_urls, locales: site.locales.length, sitemaps_read: site.sitemaps_read, as_of: site.as_of, sections: site.sections },
  site_checks: { evidence_id: 'E014', checks: checks.checks },
  tech: { evidence_id: 'E026', tools: tech.tools.map(({ tool, category }) => ({ tool, category })), notes: tech.notes },
  pricing: { evidence_id: 'E009', billing: null, plans: pricing.plans, add_ons: pricing.add_ons },
};

// ---- the analyst's read (descriptive, every claim cited) ----
const analysis = {
  company: { name: 'Exa', domain: 'exa.ai', one_liner: 'Search API for AI agents that need real-time web data.' },
  summary: {
    text: 'Exa grows as a developer platform. A free API tier, an MCP server and SDKs get developers building, and it rides other platforms people already use: Vercel, Codex, ChatGPT and Firefox. It ships something every week or two and announces each launch on X and LinkedIn, where the CEO\'s posts draw the biggest numbers. Search ads and comparison pages catch people already shopping for a search API.',
    evidence_ids: ['E009', 'E019', 'E024', 'E015', 'E016', 'E017', 'E004', 'E012'],
  },
  channels: [
    { channel: 'founder_social', strength: 'heavy',
      read: 'The CEO\'s X posts get the biggest numbers of any account we sampled; his $100m revenue post drew about 40 times his usual engagement.',
      activity: 'X: 9 posts in 2 weeks sampled · LinkedIn: 11.5k followers', evidence_ids: ['E016', 'E018', 'E031'] },
    { channel: 'open_source', strength: 'heavy',
      read: `${gh.repos} public repos with ${gh.stars.toLocaleString('en-US')} stars. The MCP server and two demo apps built on the API carry most of them.`,
      activity: `${gh.top.filter((r) => r.pushed >= '2026-10-01').length} of the top repos pushed this month`, evidence_ids: ['E019'] },
    { channel: 'partnerships', strength: 'heavy',
      read: 'Three platform launches in two months put Exa inside tools developers already use: Vercel, Codex and ChatGPT, and Firefox.',
      activity: '3 partnership launches since 18 Aug', evidence_ids: ['E024'] },
    { channel: 'social', strength: 'active',
      read: 'The company announces launches as X threads and LinkedIn posts every few days. The Exa 3.0 launch thread drew about 35 times the account\'s usual engagement on X.',
      activity: `LinkedIn: ${liPosts.length} posts in 9 weeks`, evidence_ids: ['E015', 'E017'] },
    { channel: 'google_ads', strength: 'active',
      read: `A steady search-ad program: ${running.length} ads running now, all started in October, replacing ads that ran for most of a year.`,
      activity: `52 listed · ${running.length} running · ${startedOct.length} started in Oct`, evidence_ids: ['E001', 'E002', 'E003'] },
    { channel: 'comparison', strength: 'active',
      read: `${sec('/versus').urls} "versus" and ${sec('/alternatives').urls} "alternatives" pages, with every alternatives page refreshed in the last 90 days.`,
      evidence_ids: ['E012'] },
    { channel: 'seo_content', strength: 'active',
      read: `A docs-heavy site: ${sec('/docs').urls} docs pages, ${sec('/blog').urls} blog pages and a data library. Half the blog was updated in the last 90 days.`,
      evidence_ids: ['E011'] },
    { channel: 'pricing_signup', strength: 'active',
      read: 'One button on the homepage, "Try API for free", straight into the dashboard with $10 of free credits a month.',
      evidence_ids: ['E010', 'E009'] },
    { channel: 'events', strength: 'active',
      read: 'Four webinars and meetups since mid-August, three of them between 30 Sep and 15 Oct, mostly co-hosted with another company (Crunchbase, Aaru, Gemini).',
      evidence_ids: ['E023'] },
    { channel: 'community', strength: 'active',
      read: `A ${dc.members.toLocaleString('en-US')}-member Discord; Hacker News attention is modest.`,
      evidence_ids: ['E020', 'E021'] },
    { channel: 'integrations', strength: 'active', read: `${sec('/integrations').urls} integration pages.`, evidence_ids: ['E013'] },
    { channel: 'ai_search', strength: 'active', read: 'An llms.txt and open access for every AI crawler.', evidence_ids: ['E014'] },
    { channel: 'linkedin_ads', strength: 'light', read: 'At least one launch post was promoted as a paid LinkedIn post.', evidence_ids: ['E007'] },
  ],
  connections: [
    { text: 'Launches travel through every owned channel at once: an X thread, a LinkedIn post, a blog post and, for the biggest launch, a paid LinkedIn boost.',
      evidence_ids: ['E015', 'E017', 'E011', 'E007'] },
  ],
  notable_plays: [
    { text: 'Open-source demo apps double as marketing: a company-research tool and a DeepSeek chat app built on the API have 1,517 and 728 stars.',
      evidence_ids: ['E019'] },
    { text: 'The site identifies who visits: RB2B and Common Room name visiting companies, Default routes inbound leads, and Tolt runs an affiliate program.',
      evidence_ids: ['E026', 'E025'] },
    { text: 'Search ads go after buyers outside the core developer audience too, such as people searching for a people or phone-number lookup API.',
      evidence_ids: ['E004'] },
  ],
  messaging: [
    { theme: 'Built for AI agents, not people',
      read: 'The core pitch: Exa is search designed for software to use.',
      evidence_ids: ['E010', 'E004', 'E018'],
      examples: [
        { quote: "The world's data for AI agents", where: 'site', url: 'https://exa.ai/' },
        { quote: 'An API, Not a Search Engine - Deep Search API for LLMs', where: 'google_ads', url: adUrl('CR04769995394811691009') },
        { quote: "Agents don't search like humans.", where: 'x', url: xUrl('WilliamBryk', '2110058915589464192') },
      ] },
    { theme: 'Benchmarks and research as proof',
      read: 'Claims are backed with their own benchmarks and research posts rather than customer quotes.',
      evidence_ids: ['E015', 'E016', 'E017'],
      examples: [
        { quote: 'Exa is now #1 on every benchmark we tested', where: 'x', url: xUrl('ExaAILabs', '2112218730952601719') },
        { quote: 'ATLAS is the hardest search eval in the world.', where: 'x', url: xUrl('WilliamBryk', '2108306578076299726') },
        { quote: 'We built a time machine for the web.', where: 'linkedin', url: snapshot.url },
      ] },
    { theme: 'Cheaper and more efficient',
      read: 'Price and token efficiency are pushed hard, with a concrete number each time.',
      evidence_ids: ['E004', 'E015'],
      examples: [
        { quote: 'Semantic search across 100B documents. Fast, auto and deep modes. From $4/1k.', where: 'google_ads', url: adUrl('CR04769995394811691009') },
        { quote: "We're also launching Exa Lite, our new search type at $4/1k, built for cost-sensitive apps.", where: 'x', url: xUrl('ExaAILabs', '2112218738011652336') },
        { quote: 'using 95% fewer tokens than full text', where: 'x', url: xUrl('ExaAILabs', '2112218761877230051') },
      ] },
    { theme: 'Social proof from AI leaders and scale',
      read: 'Customer logos and growth numbers stand in for testimonials.',
      evidence_ids: ['E005', 'E018'],
      examples: [
        { quote: 'Used in production at Cursor, Cognition, HubSpot and monday.com.', where: 'google_ads', url: adUrl('CR05207196402387517441') },
        { quote: 'Exa just passed $100m in annualized revenue.', where: 'x', url: xUrl('WilliamBryk', '2110058915589464192') },
      ] },
    { theme: 'Data for sales and GTM teams',
      read: 'A second audience beyond developers: teams building lead lists and enriching contacts.',
      evidence_ids: ['E004', 'E023'],
      examples: [
        { quote: 'People Search API - Phone Number Lookup API', where: 'google_ads', url: adUrl('CR14927447991626235905') },
        { quote: '50+ sources for leads in one tool', where: 'google_ads', url: adUrl('CR00491889874127814657') },
        { quote: 'Bring your toughest GTM challenges and the team will solve them live on stage!', where: 'linkedin', url: liPosts.find((p) => /GTM On the Edge/.test(p.text)).url },
      ] },
  ],
  timeline: [
    { date: '2026-10-19', kind: 'launch', text: 'Exa 3.0 and Exa Lite ($4 per 1,000 searches)', evidence_ids: ['E015'] },
    { date: '2026-10-13', kind: 'milestone', text: 'CEO announces $100m in annualized revenue', evidence_ids: ['E018'] },
    { date: '2026-10-12', kind: 'campaign', text: 'Second batch of new Google search ads (12-15 Oct), after one on 1 Oct', evidence_ids: ['E003'] },
    { date: '2026-10-09', kind: 'content', text: 'Interview with 3Blue1Brown', evidence_ids: ['E028'] },
    { date: '2026-10-08', kind: 'research', text: 'ATLAS search benchmark', evidence_ids: ['E017'] },
    { date: '2026-10-06', kind: 'launch', text: '211 million places added to the index', evidence_ids: ['E017'] },
    { date: '2026-10-01', kind: 'event', text: 'Arrived at OpenAI DevDay in a DeLorean to promote Snapshot', evidence_ids: ['E017'] },
    { date: '2026-09-25', kind: 'launch', text: 'Agent Ultra', evidence_ids: ['E017'] },
    { date: '2026-09-17', kind: 'launch', text: 'Exa Snapshot, boosted as a paid LinkedIn post', evidence_ids: ['E007'] },
    { date: '2026-08-26', kind: 'partnership', text: 'Exa on Vercel (marketplace and AI Gateway)', evidence_ids: ['E024'] },
    { date: '2026-08-20', kind: 'partnership', text: 'Exa plugin in Codex and ChatGPT', evidence_ids: ['E024'] },
    { date: '2026-08-18', kind: 'partnership', text: 'Firefox partnership', evidence_ids: ['E024'] },
  ],
  not_doing: [],
  couldnt_see: [
    { text: 'Meta and TikTok ads.', evidence_ids: ['E006', 'E008'] },
    { text: 'Reddit (search was blocked), YouTube and review sites.', evidence_ids: ['E022', 'E029', 'E030'] },
  ],
  recent_changes: [],
};

writeFileSync(join(HERE, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
writeFileSync(join(HERE, 'analysis.json'), `${JSON.stringify(analysis, null, 2)}\n`);
console.log(`wrote exa.ai fixture: ${items.length} evidence items, ${ads.length} ads, ${posts.length} posts`);
