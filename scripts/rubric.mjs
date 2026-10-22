// The scoring rubric: one question per growth activity, four levels, each level a different situation.
//
// Level 0 = nothing found. 1 = light. 2 = solid. 3 = strong.
// Rules for writing a level (they come from how the scoring model works):
//   * describe what we can SEE, as a situation. Never a degree ("fairly strong").
//   * a level must be separate from its neighbours: one clear thing tells you which level you are on.
//   * one dimension per question. If a company has one part of it and not another, the score lands between
//     two levels and the confidence drops. That is the honest answer for a mixed picture.
// The same text drives the model score (scripts/score.mjs) and the analyst fallback (agents/sneak-analyst.md).

import { fileURLToPath } from 'node:url';
import { isMain } from './ismain.mjs';
import { resolve } from 'node:path';

export const LEVEL_NAMES = ['Not seen', 'Light', 'Solid', 'Strong'];

// channels: which collected channels feed this activity. group: paid | owned | earned (used for the scoring
// prompt only; the report groups activities by SECTIONS in scripts/scoreboard.mjs).
export const ACTIVITIES = [
  {
    id: 'organic_social', label: 'Company social', group: 'earned', channels: ['social'],
    question: "How active is the company's own social presence?",
    levels: [
      'No company social account found, or none with posts we could see.',
      'An account exists but posts are rare, or the latest posts are over 90 days old.',
      'Regular posts in the last 90 days that get steady engagement.',
      "Frequent posts, and several individual posts clearly beat the account's usual engagement.",
    ],
  },
  {
    id: 'founder_social', label: 'Founder-led social', group: 'earned', channels: ['founder_social'],
    question: 'How much does a founder or executive use their own account to promote the company?',
    levels: [
      'No founder or executive posting found.',
      'A founder or executive account exists but posts are rare or old.',
      'A founder or executive posts regularly and gets steady engagement.',
      "A founder or executive posts regularly, has a large following, and posts often beat the account's usual engagement.",
    ],
  },
  {
    id: 'google_ads', label: 'Google ads', group: 'paid', channels: ['google_ads'],
    question: 'How much effort do they put into Google ads?',
    levels: [
      'No Google advertiser found.',
      'A few ads (under 10), or only ads that stopped running.',
      'Ads running now: 10 to 50 ads, a few running for 60 days or more.',
      'More than 50 ads across several messages, several running for 120 days or more.',
    ],
  },
  {
    id: 'paid_social', label: 'Paid social', group: 'paid', channels: ['meta_ads', 'linkedin_ads', 'tiktok_ads'],
    question: 'How much do they advertise on Meta, LinkedIn or TikTok?',
    levels: [
      'No ads found on Meta, LinkedIn or TikTok.',
      'A few ads on one platform.',
      'Several different ads on one platform, or a few on two.',
      'Many different ads running on two or more platforms.',
    ],
  },
  {
    id: 'seo_content', label: 'Content and SEO', group: 'owned', channels: ['seo_content'],
    question: 'How much useful content do they publish for search and readers?',
    levels: [
      'No blog or content section found.',
      'A small content section (under 50 pages), or one that has not been updated in a year.',
      'Between 50 and 500 content pages, with some updated in the last 6 months.',
      'More than 500 content pages, with a large share updated in the last 90 days.',
    ],
  },
  {
    id: 'aeo', label: 'AI-search readiness', group: 'owned', channels: ['ai_search'],
    question: 'How ready is the site for AI assistants to read and cite?',
    levels: [
      'AI crawlers are blocked, or the main content cannot be read without running scripts.',
      'The site can be read, but has no AI-specific signals (no llms.txt, no structured data).',
      'One AI-specific signal: either an llms.txt file or structured data.',
      'An llms.txt file and structured data, with AI crawlers explicitly allowed.',
    ],
  },
  {
    id: 'comparison', label: 'Comparison pages', group: 'owned', channels: ['comparison'],
    question: 'How much of the "us versus them" search ground do they cover?',
    levels: [
      'No comparison or alternatives pages found.',
      'One or two comparison pages, or pages that look out of date.',
      'Three to six comparison pages covering different rivals.',
      'Seven or more comparison pages covering many rivals, kept up to date.',
    ],
  },
  {
    id: 'customer_proof', label: 'Customer proof', group: 'owned', channels: ['reviews'],
    question: 'How much customer proof do they show?',
    levels: [
      'No customer logos, stories or reviews found.',
      'Customer logos or a few short testimonials.',
      'Several named customer stories, or reviews on one review site.',
      'A section of ten or more customer stories, plus reviews on a third-party site.',
    ],
  },
  {
    id: 'community', label: 'Community', group: 'earned', channels: ['community'],
    question: 'How active is the community around the product?',
    levels: [
      'No public community found (forum, Discord, Slack or discussion board).',
      'A community exists but looks small or quiet.',
      'An active community with regular threads and company staff replying.',
      'A large, busy community (thousands of members) where members answer each other.',
    ],
  },
  {
    id: 'open_source', label: 'Open source', group: 'earned', channels: ['open_source'],
    question: 'How much does open source bring people to the company?',
    levels: [
      'No public code found.',
      'A few repositories with little attention (under 100 stars in total).',
      'Repositories with hundreds of stars that were updated in the last year.',
      'A flagship project with 1,000 or more stars and active contributors.',
    ],
  },
  {
    id: 'partnerships', label: 'Partnerships', group: 'earned', channels: ['partnerships', 'integrations'],
    question: 'How much do partners and integrations bring in customers?',
    levels: [
      'No partners or integrations found.',
      'One partner or integration mentioned.',
      'A partners page, or several named integrations.',
      'An official partner status with a major platform, or a partner programme with several listed partners.',
    ],
  },
  {
    id: 'press', label: 'Press and podcasts', group: 'earned', channels: ['press_podcasts'],
    question: 'How much press and podcast coverage do they get?',
    levels: [
      'No press or podcast coverage found.',
      'One or two mentions.',
      'Several articles, interviews or podcasts in the last 90 days.',
      'Steady coverage from well-known outlets or many appearances through the year.',
    ],
  },
  {
    id: 'events', label: 'Events and webinars', group: 'earned', channels: ['events'],
    question: 'How much do they use events and webinars?',
    levels: [
      'No events or webinars found.',
      'One event or webinar.',
      'A few events or webinars in the last year.',
      'A regular programme (about monthly), or they host their own event.',
    ],
  },
  {
    id: 'video', label: 'Video', group: 'earned', channels: ['video'],
    question: 'How much do they use video?',
    levels: [
      'No video channel found.',
      'A channel exists with only a few videos.',
      'Regular uploads over the last year.',
      'Regular uploads and clearly strong view counts.',
    ],
  },
  {
    id: 'referral', label: 'Referral and affiliate', group: 'earned', channels: ['referral'],
    question: 'How much do they use referrals or affiliates?',
    levels: [
      'No referral, affiliate or startup programme found.',
      'An informal offer, such as a startup discount.',
      'A named referral or affiliate programme.',
      'A referral or affiliate programme with public terms and a way to apply or track.',
    ],
  },
  {
    id: 'signup_entry', label: 'Ways to start', group: 'owned', channels: ['pricing_signup'],
    question: 'How easy is it for a new visitor to start using the product?',
    levels: [
      'No way to start without talking to the company.',
      'A demo request is the only way to start.',
      'Self-serve sign-up exists, but with a card, a long form or a gate before any value.',
      'A free tier or trial with a short sign-up, and value before any payment.',
    ],
  },
  {
    id: 'pricing', label: 'Pricing page', group: 'owned', channels: ['pricing_signup'],
    question: 'How clearly is pricing shown?',
    levels: [
      'No pricing shown.',
      'Only "contact us" for every plan.',
      'Some plans have public prices, others are custom.',
      'Every plan is public, with a clear price unit and clear tiers.',
    ],
  },
];

export const ACTIVITY_BY_ID = Object.fromEntries(ACTIVITIES.map((a) => [a.id, a]));

// 0 to 3 on the rubric -> 0 to 100.
export const toPercent = (score, levels = 4) => Math.round((score / (levels - 1)) * 100);
export const nearestLevel = (score) => Math.max(0, Math.min(3, Math.round(score)));

export function toMarkdown() {
  const groups = { paid: 'Paid', owned: 'Owned', earned: 'Earned and social' };
  return ['# Scoring rubric', '', 'Four levels per activity: 0 Not seen · 1 Light · 2 Solid · 3 Strong.', '',
    ...Object.entries(groups).flatMap(([g, name]) => [`## ${name}`, '', ...ACTIVITIES.filter((a) => a.group === g).flatMap((a) => [
      `### ${a.label} (\`${a.id}\`)`, `*${a.question}*`, '', ...a.levels.map((l, i) => `- **${i}.** ${l}`), ''])])].join('\n');
}

if (isMain(import.meta.url)) {
  if (process.argv.includes('--md')) console.log(toMarkdown());
  else console.log(JSON.stringify({ activities: ACTIVITIES.length }, null, 2));
}
