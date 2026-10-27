> **Machine-made blocks.** `site` and `site_checks` come straight from `raw/sitemap.json` and `raw/sitecheck.json`, and
> `pricing` from the saved Firecrawl JSON extraction of the pricing page, all built by `scripts/extract.mjs`. Run the
> extraction (so the response is saved); do not copy those numbers into your fragment.

# Layer: owned

Channels: `seo_content`, `comparison`, `pricing_signup`, `integrations`, `ai_search`, `traffic`, and `reviews`
for customer proof on the company's own site (customer stories, named testimonials, logo walls).

## From the free script outputs (no cost)
- **Page families come from `page_types` in `$R/raw/sitemap.json`** (comparison, landing, integrations,
  customers, templates, jobs, webinars, docs_help), matched by slug anywhere in the path: a page like
  `/f/hubspot-crm-alternatives` counts as a comparison page. **Never grep the URL list yourself for a
  page type.** Open the `examples` of every family you write about to confirm they are what the name says.
  Only when `page_types.comparison.urls` is 0, you have also fetched the homepage and pricing page links
  to check for a "Compare" or "Alternatives" menu entry, and the sitemaps were fully read (not capped,
  none failed) may you write a checked absence. Say all of that in the `probe`.
- `$R/raw/sitemap.json` -> the `site` block (copy `total_urls`, `locales` count, `sitemaps_read`, `as_of`,
  `sections`) plus items for: the size of the site and its biggest sections; comparison pages (`/vs`,
  `/versus`, `/compare*`, `/alternatives*`) with counts and how many were updated in the last 90 days;
  template, integration, customer-story and landing-page families; anything updated heavily in 90 days.
- `$R/raw/sitecheck.json` -> the `site_checks` block plus one `ai_search` item summarising llms.txt,
  AI-crawler access and structured data.

## Site traffic (Firecrawl Alexandria, Similarweb; 660 credits, only when `run.json` has `"traffic": true`)
If `traffic` is false, skip this section and write no traffic item: the report simply has no traffic section.
Follow `references/alexandria.md`: discover first (`firecrawl_find_tools`, free), read the contract and the price,
then call only `similarweb` `web/traffic`. It returns **one complete month per call** and costs 110 credits per
metric, so ask for `visits` only and six months (the six complete months before today), in one
`firecrawl_scrape` with six `alexandria` entries (`domain` bare and lowercase, `start_date` = `end_date` =
`YYYY-MM`, `granularity: monthly`, `metrics: visits`). Empty months cost nothing. Write one `traffic` item
(url `https://www.similarweb.com/website/<domain>/`, finding = the latest month and the change since the first
month, as numbers) and the `traffic` block: `{ "metric": "visits", "label": "Monthly visits (all countries, all
devices)", "points": [{ "month": "2026-04", "value": 174323 }, ...], "source": "Similarweb", "source_url",
"last_updated", "evidence_ref" }`. Round values to whole visits. These are **estimates**; say so in the finding.
If the call fails or the provider needs terms, record a `couldnt_check` item and skip the block. Report the
credits spent.

## Pricing and funnel (Firecrawl, about 15 credits)
- `/pricing`: `firecrawl_scrape` with `formats: ["json", "screenshot"]` and a JSON schema for plans
  (name, price, unit, cta, audience, key_points, free_trial) and add-ons. Write the `pricing` block and a
  `pricing_signup` item with `funnel_step: "pricing"` and the saved screenshot.
- Homepage: `firecrawl_scrape` with `formats: ["screenshot", "query"]`, asking for the headline and the
  primary buttons and where they link. Item with `funnel_step: "home"`.
- Signup page, if a "sign up"/"get started" link is public and does not require login to view:
  screenshot it with `funnel_step: "signup"`. Do not fill in anything.
- If two captures of the same page disagree (rotating headlines), record both; that is itself a finding.

## Page screenshots (these become the report's visuals; about 25 to 30 credits)
The report shows the site through screenshots, so capture real pages, not only the homepage. Choose **4 to 6**
pages, using the `examples` in `page_types` and the `sections` in `sitemap.json`:
- the homepage and the pricing page (already captured above)
- one **customer story** (`page_types.customers.examples`)
- one **comparison or alternatives page** (`page_types.comparison.examples`)
- one **product, solution or integration page**
- one recent **blog post** from their largest, freshest section
Capture each with `firecrawl_scrape` `formats: ["screenshot"]` (viewport, not full page). Save as JPEG,
about 1280px wide (`sips -Z 1280 -s format jpeg -s formatOptions 70 in.png --out $R/assets/<name>.jpg`), so the
report stays small. Add one entry per page to the fragment's `screens` array:
`{ "kind": "home|product|customers|comparison|integrations|landing|blog|pricing|signup|other",
"page_url": "...", "image": "assets/<name>.jpg", "title": "the page's own title or headline, at most 8 words", "caption": "optional: one sentence on what is on the page", "evidence_ref": "<the item describing this page>" }`. Each screen needs an item
to point at (for example the comparison-pages item). Never invent a caption; read the page first.
The funnel items (`funnel_step`) are still fine: any item with an `image` is shown as a screenshot too.

## Blog and guides (the `content` block)
Owned content that is not a comparison page or a customer story: blog posts, guides, e-books, reports, free tools,
templates, docs. Pick the 6 to 12 pieces most worth seeing: the newest posts from the biggest section of
`$R/raw/sitemap.json` plus any flagship resource (an e-book, a research report, a free tool). Open a few to read
the real title, author and date; take the rest from the sitemap and listing pages. Write one `owned_content` item
(what kinds of content exist and how much, with the section sizes) and the block:
`"content": { "items": [{ "title": "<the page's own title>", "url": "<deep link>", "kind": "blog|guide|ebook|report|tool|template|docs|video|other", "date": "YYYY-MM-DD", "author": "<name>" }], "evidence_ref": "<that item's ref>" }`.
`date` and `author` are optional; leave them out unless the page shows them (a sitemap `lastmod` is an edit date, not
a publication date, so do not use it). The report shows them as a table, newest first. Never put a comparison page or
a customer story here.

Also copy `page_types` from `$R/raw/sitemap.json` into the `site` block unchanged. The report lists the
comparison and customer-story pages from it.

## Integrations and AI search
- Integration directories and marketplace listings found in the sitemap; count them.
- Comparison pages: open two or three and quote who they compare against.

## Two clarifications from real runs
- **Integrations are not only a directory.** A sitemap with no integrations family is not an absence. Read
  the homepage menu and hero links as well: per-platform or per-partner product pages (for example
  `/product/<platform>`) and a calendar or API integration page are the integrations surface. Record what you
  find as an observed `integrations` item. Use `absent: true` only when the sitemap count is 0 **and** the
  menu and hero links show nothing.
- **Do not collect the tech stack.** The company layer owns the rendered visit and the `tech` block. Do not
  write a `tech` block or a tech `couldnt_check` item from this layer.

## Cadence and plans
- **Cadence.** Copy `by_month` from `$R/raw/sitemap.json` into the `site` block unchanged. It is the number of
  pages last updated per month for the last 12 months; the report uses it to show how fresh the content is.
- **Plans.** The `pricing` block's `plans` (name, price, cta) are shown one row per plan. Keep `price` exactly
  as shown on the page.

