# Layer: paid

Channels: `google_ads`, `meta_ads`, `linkedin_ads`, `tiktok_ads`.

## Google ads (always)
- Firecrawl Alexandria `adstransparency-google-com` / `ad-transparency/list_ads` with
  `{ "domain": "<domain>", "region": "anywhere", "limit": 40 }`. 5 credits per page of 40.
  Follow `continuation` for up to 3 pages (120 ads). Record `total_low`/`total_high` as `ads_total`.
- **Put every ad you collected in the `ads` array**, not just the ones you read. The report says "we
  collected N" from this array. `headline`
  is optional and only for ads whose image you read.
- Stop early when a page shows there are no more. Use the
  `total_low`/`total_high` for the real total; say in the findings that the rest is a sample.
- For each ad: `advertiser` (the advertiser name Google shows) and `own` (`true` when it is the company itself,
  `false` when it is someone else pointing at the domain, such as a customer or reseller), `format` (TEXT/IMAGE/VIDEO lower-cased), `days_shown`, `first_shown` and `last_shown`
  (YYYY-MM-DD), `image_url` + `width`/`height` when the preview is an image, and the ad's `url`.
- **Read the headlines.** Download the thumbnails of the 6-10 longest-running and 4-6 newest ads
  (`curl -s -o $R/assets/ad-<n>.png <image_url>`), open each downloaded file with your image-reading tool,
  and copy the headline text verbatim into `headline` (include a notable sitelink in brackets). This is the
  most valuable thing in this layer: the words they pay for.
- Items to write: total listed; how many are running now (last shown within 3 days); when the current
  batch started; the longest runners; headline patterns (category, use case, brand, competitor sitelinks,
  price anchors), quoting 3-5 headlines.

## Meta, LinkedIn, TikTok
- Meta: Alexandria `upspring` `advertisers/by-domain` (100 credits, free if Upspring doesn't have the brand).
  If unavailable, write a `couldnt_check` item whose url is the Meta Ad Library search link.
- LinkedIn and TikTok: no reliable API. Write `couldnt_check` items with the library links, unless the
  user has an Apify connection.
- **Evidence of paid social without the libraries:** landing pages named after channels in
  `$R/raw/sitemap.json` (e.g. `/lp/linkedin-*`, `/lp/meta`, `/lp/yt`), UTM parameters with
  `utm_medium=paid` on posts the social collector found, and ad pixels in the tech stack. Record each as
  an `observed` item on the matching channel ("A Meta landing page exists"), never as spend.

## Google lookup details
- Capability names carry a prefix: `ad-transparency/search_advertisers`, `ad-transparency/list_ads`. Search
  advertisers by brand name first, then list ads by the advertiser id or by domain.
- If the brand name, the legal-entity name (for example "Acme Inc") and the domain all return no advertiser
  and no ads, that is an observed result on Google's own directory. Record it as one `google_ads` item with
  `absent: true` and a `probe` that lists the exact queries and the region searched, and say that other
  regions and entity names were not searched. A failed or rate-limited call is `couldnt_check`.
- When there is no total, leave `ads_total` out of the fragment. Never write `null` values into it.
- Meta, LinkedIn and TikTok: if you did not open their libraries, write one `couldnt_check` item each. The
  report shows them as "Not covered".

## Meta ads through Upspring (Alexandria, 100 + 50 credits, free when unsourced)
Read `references/alexandria.md`. Discover `upspring` `advertisers/by-domain` and `ads/browse` (free), then:
1. `advertisers/by-domain` with `{ "domain": "<domain>" }` (100 credits; free and `status: unavailable` when Upspring
   has no data, which is common for B2B software: Upspring's corpus is mostly consumer brands). If `unavailable`,
   record one `couldnt_check` item ("Upspring has no data for this brand"; not proof of no Meta ads) and stop.
2. If `status` is `ready` (or `pending`: poll once after `refetch_after` seconds), call `ads/browse` with
   `{ "advertiser_id": ["<id>"], "is_active": "true", "order_by": "best", "limit": 8, "include": "media" }` (50 credits).
3. Write one `meta_ads` item (the facts: active ad count, creative mix, spend grade, with the Ad Library url of the
   top ad) and the `meta_ads` block: `{ "source": "Upspring", "advertiser": { id, name }, "active_ads": social.active_ads,
   "as_of": social.as_of, "spend": enrichment.spend (grade, floor, estimated), "creative_mix": { "media": signals.media_mix,
   "funnel": signals.funnel, "mechanisms": signals.mechanisms } as [{ label, share }], "ads": [{ id, media_type,
   is_active, started_at (YYYY-MM-DD), one_line, hook_text, impressions (strength.impressions, 1 to 5), url
   (ad_library_url), thumbnail_url (media.thumbnail_url), width, height }], "evidence_ref" }`.
Spend, traffic and sales grades are **estimates**; the report says so. Report the credits spent.
