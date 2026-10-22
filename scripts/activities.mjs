// The growth activities every report covers, in a fixed list so two reports can be read side by side.
// An activity reads the evidence filed under one or more channels (scripts/channels.mjs); the report groups
// activities into sections in scripts/scoreboard.mjs. Nothing here is scored: a report says what we saw.

export const ACTIVITIES = [
  { id: 'organic_social', label: 'Company social', channels: ['social'] },
  { id: 'founder_social', label: 'Founder-led social', channels: ['founder_social'] },
  { id: 'google_ads', label: 'Google ads', channels: ['google_ads'] },
  { id: 'paid_social', label: 'Paid social', channels: ['meta_ads', 'linkedin_ads', 'tiktok_ads'] },
  { id: 'owned_content', label: 'Blog and guides', channels: ['owned_content'] },
  { id: 'seo_content', label: 'Content and SEO', channels: ['seo_content'] },
  { id: 'aeo', label: 'AI-search readiness', channels: ['ai_search'] },
  { id: 'comparison', label: 'Comparison pages', channels: ['comparison'] },
  { id: 'customer_proof', label: 'Customer proof', channels: ['reviews'] },
  { id: 'community', label: 'Community', channels: ['community'] },
  { id: 'open_source', label: 'Open source', channels: ['open_source'] },
  { id: 'partnerships', label: 'Partnerships', channels: ['partnerships', 'integrations'] },
  { id: 'press', label: 'Press and podcasts', channels: ['press_podcasts'] },
  { id: 'events', label: 'Events and webinars', channels: ['events'] },
  { id: 'video', label: 'Video', channels: ['video'] },
  { id: 'referral', label: 'Referral and affiliate', channels: ['referral'] },
  { id: 'signup_entry', label: 'Ways to start', channels: ['pricing_signup'] },
  { id: 'pricing', label: 'Pricing page', channels: ['pricing_signup'] },
];

export const ACTIVITY_BY_ID = Object.fromEntries(ACTIVITIES.map((a) => [a.id, a]));
