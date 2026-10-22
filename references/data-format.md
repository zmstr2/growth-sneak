# Data format

Collectors write **fragments**; `scripts/merge.mjs` turns them into `evidence.json`; the analyst writes
`analysis.json`; `scripts/render.mjs` validates both and refuses anything it can't trust.

## Fragment (`reports/<domain>/fragments/<layer>.json`)

```jsonc
{
  "layer": "paid",                        // paid | owned | social | company
  "credits": 25,                          // Firecrawl credits this collector spent (for the cost line)
  "items": [                              // every fact, one per item
    {
      "ref": "paid-google-total",         // your own key; unique within the run
      "channel": "google_ads",            // one id from scripts/channels.mjs (see references/taxonomy.md)
      "status": "observed",               // observed (we saw it) | stated (they said it) | couldnt_check
      "finding": "Google lists 52 ads for exa.ai (all regions).",   // plain English, one or two sentences
      "url": "https://adstransparency.google.com/advertiser/AR...", // deep link to the proof, never a bare homepage if a deeper one exists
      "absent": true,                     // ONLY for a recorded absence check, and then...
      "probe": "Fetched /sitemap.xml (379 URLs) and searched for /vs/ and /compare/",  // ...say exactly what you checked
      "image": "assets/pricing.jpg",      // optional local screenshot (save the file; screenshot URLs expire); shown in the site section
      "funnel_step": "pricing"            // optional: home | pricing | signup (used as the screenshot's kind)
    }
  ],
  "ads": [ /* EVERY ad you collected, not just the ones you read */ { "platform": "google", "advertiser": "Exa Labs, Inc.", "own": true, "format": "text|image|video", "days_shown": 321,
             "first_shown": "2025-07-29", "last_shown": "2026-10-01",
             "image_url": "https://tpc.googlesyndication.com/archive/simgad/...", "width": 348, "height": 451,
             "url": "https://adstransparency.google.com/advertiser/.../creative/...",
             "headline": "AI Search Engine - AI-Powered Web Search" } ],   // headline: only if you read it off the creative
  "ads_total": { "low": 52, "high": 52 },
  "posts": [ { "platform": "x", "account": "ExaAILabs", "owner": "company|founder|employee",
               "url": "https://x.com/ExaAILabs/status/...", "published": "2026-10-19", "text": "...",
               "metrics": { "likes": 2118, "reposts": 156, "replies": 91 },     // LinkedIn: reactions, comments; HN: points, comments; YouTube: views
               "reply": false, "evidence_ref": "social-x-company" } ],   // reply: true for replies to commenters (never shown as best posts)
  "accounts": [ { "platform": "linkedin", "handle": "in/william-bryk", "url": "https://www.linkedin.com/in/william-bryk",
                  "owner": "founder", "followers": 11547, "evidence_ref": "social-will-linkedin" } ],
  "oss":   { "org": "exa-labs", "url": "https://github.com/exa-labs", "repos": 50, "stars": 8545, "top": [ ... ], "evidence_ref": "..." },
  "community": { "discord": { "name": "Exa", "members": 5115, "online": 340, "evidence_ref": "..." },
                 "hacker_news": { "stories": 23, "top": [ ... ], "evidence_ref": "..." } },
  "site":        { "total_urls": 379, "locales": 0, "sections": [ ... from raw/sitemap.json ],
                   "page_types": { /* copied unchanged from raw/sitemap.json */ },
                   "by_month": [ /* copied unchanged from raw/sitemap.json: pages last updated per month */ ], "evidence_ref": "..." },
  "screens":     [ { "kind": "home|product|customers|comparison|integrations|landing|blog|pricing|signup|other",
                     "page_url": "https://...", "image": "assets/customer-story.jpg",
                     "title": "page title, at most 8 words", "caption": "optional longer note", "evidence_ref": "..." } ],
  "site_checks": { "checks": [ ... from raw/sitecheck.json ], "evidence_ref": "..." },
  "tech":        { "tools": [ { "tool": "HubSpot", "category": "Marketing automation" } ], "notes": [ ... ], "evidence_ref": "..." },
  "pricing":     { "billing": "monthly|null", "plans": [ { "name", "price", "unit", "cta", "audience", "key_points": [] } ], "add_ons": [], "evidence_ref": "..." }
}
```

Rules the renderer enforces (a broken rule is a hard error, not a warning):
- every `evidence_ref` / `evidence_id` must point at a real item
- every `url` must be an http(s) link
- an item with `absent: true` must be `observed` and have a `probe`
- posts need `platform`, `account`, `url` and a real `published` date

## `analysis.json` (written by the analyst)

```jsonc
{
  "company":   { "name": "Recall.ai" },
  "headline":  { "text": "Grows through founder-led LinkedIn posts, comparison pages and a Zoom partnership.", "evidence_ids": ["E020", "E006"] },
  "reads":     [ { "activity": "comparison", "read": "Seven comparison pages, all updated in 90 days.", "evidence_ids": ["E006"] } ],
  "plays":     [ { "activity": "comparison" }, { "activity": "founder_social" } ],
  "takeaways": [ { "activity": "comparison", "observed": "...", "move": "Write ...", "evidence_ids": ["E006"] } ],
  "couldnt_see": [ { "text": "Meta ads: Upspring has no data for this brand.", "evidence_ids": ["E002"] } ],
  "activity_levels": [ { "activity": "comparison", "level": 3, "evidence_ids": ["E006"] } ]   // only without a TypeSafe key
}
```
Activity ids are the ones in `scripts/rubric.mjs`. Anything uncited is dropped; an unknown evidence id stops the
render. Older files may carry `summary` (used only if there is no headline) and other fields that are ignored.

## Exhibits
Every post, ad and screenshot in `evidence.json` has an id (`P001…`, `AD001…`, `S01…`, assigned by `merge.mjs`).
The renderer places each one in the activity it belongs to (`scripts/proof.mjs`) and never draws the same one
twice. A post with no readable numbers says "Engagement not visible", never zero.

## Notes from real runs
- `ads_total`: leave the key out when no total is known. Do not write `{"low": null, "high": null}`.
- Follower counts: put the source and date in the item `finding`; there is no separate field.
- `tech` is written only by the `company` layer; the `owned` layer never writes it.

## `scores.json` (written by `scripts/score.mjs`; read by the renderer)

```jsonc
{ "model": "jev-1.13.0", "scored_at": "...", "usage": { "input_tokens": 6478, "output_tokens": 70 },
  "activities": {
    "comparison": { "score": 100, "level": 3, "raw": 2.98, "confidence": 1.0,
                    "probabilities": { "0": 0, "1": 0, "2": 0.01, "3": 0.99 },
                    "basis": "jev", "evidence_ids": ["E006"] },
    "google_ads": { "score": 0, "level": 0, "confidence": null, "basis": "checked_absence", "evidence_ids": ["E001"] },
    "paid_social": { "score": null, "basis": "not_covered" } } }
```

`basis` is `jev` (model score), `analyst` (fallback level), `checked_absence` (a plain 0, only with a recorded
check), `not_covered` (nothing to score: shown as "Not covered", never as 0) or `no_answer`. A low `confidence`
(under about 0.5) means the picture is mixed or thin; the report shows it.

## traffic (evidence.json)
`traffic`: `{ metric: 'visits', label, points: [{ month: 'YYYY-MM', value }], source, source_url, last_updated?, evidence_id }`. Estimates from Similarweb via Alexandria; the renderer draws a line chart and the cited finding, in the Site traffic section. Needs a `traffic` channel evidence item.

## meta_ads (evidence.json)
`meta_ads`: `{ source, advertiser: { id, name }, active_ads?, as_of?, spend?: { grade, floor, estimated }, creative_mix?: { media, funnel, mechanisms: [{ label, share }] }, ads: [{ id, media_type, is_active, started_at, one_line, hook_text?, impressions?, url, thumbnail_url? }], evidence_id }`. From Upspring via Alexandria. Shown in the Paid social block: a row of ad previews, a facts line (estimates, labelled) and library links. Instagram and TikTok posts use the normal `posts` entries (add `thumbnail_url` to show a preview) and `accounts` entries with `followers`.
