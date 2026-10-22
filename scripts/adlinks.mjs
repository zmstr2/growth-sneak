// Deep links into each platform's free public ad library. No key, no cost, never stale.
// `precision` tells the reader how much to trust the match: a domain filter is exact,
// a brand-name search can match the wrong advertiser.

export function brandFromDomain(domain) {
  const host = String(domain).replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  const parts = host.split('.');
  return parts.length > 1 ? parts[parts.length - 2] : parts[0];
}

export function adLibraryLinks(domain, brand = brandFromDomain(domain)) {
  const d = encodeURIComponent(domain);
  const b = encodeURIComponent(brand);
  return [
    {
      platform: 'google',
      label: 'Google Ads Transparency',
      url: `https://adstransparency.google.com/?region=anywhere&domain=${d}`,
      precision: 'exact',
      note: 'Filtered by domain',
    },
    {
      platform: 'meta',
      label: 'Meta Ad Library',
      url: `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&q=${b}&search_type=keyword_unordered`,
      precision: 'keyword',
      note: 'Keyword search; check the advertiser name',
    },
    {
      platform: 'linkedin',
      label: 'LinkedIn Ad Library',
      url: `https://www.linkedin.com/ad-library/search?accountOwner=${b}`,
      precision: 'keyword',
      note: 'Name search; check the advertiser name',
    },
    {
      platform: 'tiktok',
      label: 'TikTok Ad Library',
      url: `https://library.tiktok.com/ads?region=all&adv_name=${b}`,
      precision: 'keyword',
      note: 'Name search; mostly EU delivery',
    },
  ];
}
