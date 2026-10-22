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

## Meta (always): the public Ad Library, through Firecrawl
Meta's Ad Library is public and needs no login. Read it with one `firecrawl_scrape` (5 credits), asking for
structured data so you do not have to read a page of markup:

```json
{ "url": "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&q=<domain>&search_type=keyword_unordered",
  "formats": ["json"], "waitFor": 6000, "maxAge": 0,
  "jsonOptions": { "prompt": "Extract every ad card in page order. Also the total shown near the top (for example '~99 results'). primary_text is the full ad text above the creative. creative_image_url is ONLY an image that sits inside the clickable link block under the ad text (the block that also holds the display-link domain, headline and button), whose URL contains 's600x600'. Never use the small round advertiser avatar (URL contains 's60x60'). If the link block has no such image (video ads show 'Sorry, we're having trouble playing this video' instead), return null. is_video is true when the card shows that video message.",
    "schema": { "type": "object", "properties": { "results_label": { "type": "string" }, "ads": { "type": "array", "items": { "type": "object", "properties": {
      "library_id": { "type": "string" }, "started_running": { "type": "string" }, "advertiser": { "type": "string" }, "advertiser_page_url": { "type": "string" },
      "avatar_url": { "type": "string" }, "primary_text": { "type": "string" }, "creative_image_url": { "type": ["string", "null"] }, "is_video": { "type": "boolean" },
      "display_link": { "type": "string" }, "headline": { "type": "string" }, "description": { "type": ["string", "null"] }, "cta_button": { "type": "string" },
      "destination_url": { "type": "string" } } } } } } } }
```

Search the **domain** (`q=subsplash.com`), which matches ads that link to the site. The results are sorted by
Meta's own impressions order, so the first cards are the ones Meta shows most. The first screen holds about 8 to 30
ads; do not scroll for more.

What to do with the answer:
- **Own or not.** Keep an ad as the company's own only when its advertiser name is the brand or a clear variant
  of it (Subsplash, Subsplash Inc). Ads run by customers, resellers or affiliates that link to the site are not the
  company's: count them, name the kinds ("church pages pointing at the site"), never put them in `ads`.
- **Download the pictures now.** Meta's image links expire within days. For each own ad you keep (at most 8, the
  first ones in page order), `curl -sL -o "$R/assets/meta-<library_id>.jpg" "<creative_image_url>"` when there is one,
  and once per advertiser `curl -sL -o "$R/assets/meta-avatar-<n>.jpg" "<avatar_url>"`. Check each file opens as an
  image (`file` says JPEG or PNG); if a download fails, leave that field out and say nothing about it. Never store
  the Meta URLs.
- Write one `meta_ads` item: how many of the company's own ads were on the first screen, what the oldest and newest
  start dates are, and 2 or 3 quoted headlines or hooks. Its `url` is the search link above. Say "first screen" or
  "sample": the page is a sample, not a count. The `results_label` (for example "~94 results") is the total for the
  keyword search, own and others together; quote it as that, never as the company's ad count.
- Write the `meta_ads` block: `{ "source": "Meta Ad Library", "advertiser": { "id": "<page url slug>", "name": "<advertiser>" },
  "ads": [{ "id": "<library_id>", "media_type": "video|image", "is_active": true, "started_at": "YYYY-MM-DD",
  "advertiser": "<name>", "avatar": "assets/meta-avatar-1.jpg", "primary_text": "<full text>", "image": "assets/meta-<id>.jpg",
  "is_video": true|false, "display_link": "<as shown>", "headline": "...", "description": "...", "cta": "<button text>",
  "url": "https://www.facebook.com/ads/library/?id=<library_id>" }], "evidence_ref" }`. The report draws each one the
  way Meta does: advertiser, "Sponsored", text, the picture, then the domain, headline and button. Leave out `image`
  for a video ad: the library gives no readable frame for videos, and the report shows a "Video ad" panel that
  links to the library. Leave out `impressions`, `spend` and `creative_mix`; do not set `active_ads` to the keyword
  total.
- **Zero own ads on the first screen** is an observed result on Meta's own library for that domain query, so record
  one `meta_ads` item with `absent: true` and a `probe` naming the exact query, the country (`ALL`), the status
  filter (active only) and that ads by other names or older ads were not searched. If the scrape returns an error,
  a login wall or nothing readable, it is `couldnt_check`, never an absence.
- Costs 5 credits; add it to `credits`.

## LinkedIn and TikTok
- **LinkedIn:** the public Ad Library blocks Firecrawl even with the stealth proxy (tested), and there is no API.
  Write one `couldnt_check` item whose `url` is the library search link and say why ("LinkedIn's Ad Library blocks
  automated reads"). If the user has an Apify connection, you may use an Apify actor for it.
- **TikTok:** the Commercial Content Library covers mostly EU delivery and has no stable public read. Write one
  `couldnt_check` item with the library link.
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

## Meta spend estimates through Upspring (optional; only if the user asks)
The Ad Library above is the default. Upspring (Alexandria, 100 + 50 credits, free when it has no data) adds
estimates of spend and creative mix, but mostly for consumer brands. Read `references/alexandria.md` before using it.
If you use it, put its numbers in the same `meta_ads` block (`spend`, `creative_mix`, `active_ads`, `as_of`,
`impressions` per ad) with `source: "Upspring"`; the report labels them as estimates. Never run it by default.
