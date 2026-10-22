// What a collector files each piece of evidence under. One definition of "a channel", shared by the
// merge step, the renderer and the scoring rubric (rubric.mjs lists which channels feed each activity).
export const CHANNELS = [
  { id: 'google_ads', label: 'Google ads' },
  { id: 'meta_ads', label: 'Meta ads' },
  { id: 'linkedin_ads', label: 'LinkedIn ads' },
  { id: 'tiktok_ads', label: 'TikTok ads' },
  { id: 'seo_content', label: 'SEO & content' },
  { id: 'comparison', label: 'Comparison pages' },
  { id: 'pricing_signup', label: 'Pricing & signup' },
  { id: 'integrations', label: 'Integrations & platform' },
  { id: 'ai_search', label: 'AI-search readiness' },
  { id: 'social', label: 'Social (company)' },
  { id: 'founder_social', label: 'Founder-led social' },
  { id: 'video', label: 'YouTube & video' },
  { id: 'community', label: 'Community' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'press_podcasts', label: 'Press & podcasts' },
  { id: 'referral', label: 'Referral & affiliate' },
  { id: 'open_source', label: 'Open source & dev community' },
  { id: 'events', label: 'Events & webinars' },
  { id: 'partnerships', label: 'Partnerships & marketplaces' },
  { id: 'hiring', label: 'Hiring' },
  { id: 'traffic', label: 'Site traffic' },
  { id: 'martech', label: 'Martech & tracking' },
];

export const CHANNEL_BY_ID = Object.fromEntries(CHANNELS.map((c) => [c.id, c]));

export const SOURCE_LABELS = {
  firecrawl: 'Firecrawl',
  exa: 'Exa',
  jev: 'Jev (TypeSafe)',
  apify: 'Apify',
};
