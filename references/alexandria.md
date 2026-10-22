# Firecrawl Alexandria: extra data providers (optional)

Alexandria is a catalogue of data providers you call through the Firecrawl connection you already have. It
fills gaps the free scripts and plain scraping cannot: structured job boards, Meta ads, search interest,
website traffic, social posts. Everything here is optional. Without it, the report is thinner, never wrong.

## The rules (every collector follows them)
1. **Discover before you retrieve.** `firecrawl_find_tools` is free. Look the capability up, read its inputs
   and price, then call it with `firecrawl_scrape` and `alexandria: { provider, capability, options }`.
2. **Call only what discovery returned**, with inputs exactly as its contract says.
3. **Know the price first.** Note each call's `creditsCost` and add it to `credits` in your fragment. Similarweb
   rows and referrals cost hundreds of credits: do not call the expensive ones unless the brief says to.
4. **Rate limit: about 10 requests a minute, shared by all collectors.** Batch up to 10 capabilities in one
   `alexandria` array. On a rate-limit error wait 30 seconds and retry once with the same payload.
5. **Provider terms.** Some providers (Apollo, Particle) need an organisation admin to accept their terms in the
   Firecrawl dashboard. If a call returns `THIRD_PARTY_DATA_TERMS_REQUIRED`, stop calling that provider, record
   one `couldnt_check` item naming it and the link in the error, and carry on. **Never accept terms, and never
   ask the user to paste anything.** If the user wants it, they open the link themselves.
6. **An error or "unavailable" is `couldnt_check`, never an absence.** A provider that does not know a brand has
   not told you the brand does not exist.

## What we use, what it costs (credits, as published), what it feeds

| Provider and capability | Cost | What it gives | Feeds |
|---|---|---|---|
| `ashbyhq-com` `jobs/jobs` (board slug from the careers page, e.g. `jobs.ashbyhq.com/<Slug>`) | 5 | every open role: title, team, location, publish date, salary and equity | not used in the report |
| `greenhouse-io` (board token) | about 5 | the same for Greenhouse boards | not used in the report |
| `adstransparency-google-com` `ad-transparency/search_advertisers`, `list_ads` | 5 per page | Google ads | Google ads |
| `upspring` `advertisers/by-domain` | 100 (free if unsourced) | Meta ads: hooks, offers, top ads, follower counts | Paid social |
| `firecrawl-trends` `trends/interest_over_time` | 5 | weekly search interest for up to 5 terms | not used in the report |
| `similarweb` `web/traffic` with `metrics: "visits"`, one month per call | 110 per month | monthly visits | Site traffic (six months, only when the user opted in) |
| `x-com`, `youtube-com`, `oriane` (TikTok and Instagram) | see contract | posts, channels, videos, follower counts | social, video |
| `alternativeto-net` | see contract | the alternatives people list for a product | comparison pages |
| `github-com` | 5 | repos and stars (the free `social.mjs` already covers this: skip it) | open source |
| `apollo` `companies/enrich`, `particle` podcasts | 30, 5 to 15 | headcount, funding, tech; podcast mentions and sponsors | needs terms accepted first |

Not in Alexandria (checked): G2, Capterra, Trustpilot, Reddit, Hacker News (the free script covers it), Product
Hunt and LinkedIn. Reviews and LinkedIn posts stay with Exa.

## Notes from the first real calls (recall.ai)
- Ashby needs the exact board slug. Read it off the careers page source (`ashbyBaseJobBoardUrl`): for
  recall.ai it was `Recall`, not `recall.ai`. A wrong slug returns not found.
- Upspring answered "unavailable" for recall.ai (free): no Meta data, not proof of no Meta ads.
- Trends needs search terms, not a domain; a brand name that is also a common phrase gives noisy lines.
- Similarweb has its own monthly allowance on the account; the price is per metric returned.


## Site traffic (used in the report)
`similarweb` / `web/traffic`: one complete month per call, 110 credits per metric returned (max 5 metrics), `start_date` and `end_date` the same `YYYY-MM`, `metrics` a comma list from visits, average_visit_duration, pages_per_visit, bounce_rate, unique_visitors. In practice only `visits` came back for a small site; the other fields were null. Six months of visits = 660 credits. Data is lagged about a month (last_updated was 2026-09-30 on 2026-10-21). Tested on recall.ai: Apr–Sep 2026 returned.

## Used in the report: Upspring (Meta ads) and Oriane (Instagram, TikTok)
- `upspring` `advertisers/by-domain` 100 credits (free if unavailable) then `ads/browse` 50 credits per page, with
  `include: "media"` for preview thumbnails. Tested on mudwtr.com: a rich brief (226 active ads, creative mix, spend
  grade, hook themes) and 8 ads with Ad Library links and thumbnails, 150 credits in total. Recall.ai (B2B software)
  was `unavailable`. Shown in the Paid social block as a row of ad previews plus one line of facts.
- `oriane` `instagram/posts-search`, `tiktok/posts-search` (20/30/40 credits by projection, free when empty) and
  `instagram/profiles-search`, `tiktok/profiles-search`. Search by exact `handle`. Tested with `mudwtr`: empty, no
  credits charged. Results become `posts` and `accounts` entries, shown in Organic social.
