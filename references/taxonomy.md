# How the report is organised

Three lists, from the most detailed to the most readable. They are fixed: every run collects, scores and shows
the same things, so two reports can be compared side by side. A company that does nothing on an activity still
gets the activity, marked "Not covered" or "Checked, none found".

1. **Channels** (`scripts/channels.mjs`): what a collector files each piece of evidence under, for example
   `google_ads`, `founder_social`, `pricing_signup`. Every evidence item has exactly one channel.
2. **Activities** (`scripts/rubric.mjs`, 17 of them): what gets a score from 0 to 100. Each activity reads the
   evidence from one or more channels and has a four-level rubric (0 Not seen, 1 Light, 2 Solid, 3 Strong).
3. **Sections** (`SECTIONS` in `scripts/scoreboard.mjs`): how the report groups the activities for a reader.

| Section | Activities (channels they read) |
|---|---|
| Organic social | Company social (`social`), Founder-led social (`founder_social`), Video (`video`) |
| SEO and AEO | AI-search readiness (`ai_search`), Content and SEO (`seo_content`) |
| Owned content | Comparison pages (`comparison`), Customer proof (`reviews`) |
| Earned content | Press and podcasts (`press_podcasts`), Events and webinars (`events`) |
| Paid social | Paid social (`meta_ads`, `linkedin_ads`, `tiktok_ads`) |
| Paid search | Google ads (`google_ads`) |
| Signup and pricing | Ways to start, Pricing page (both `pricing_signup`) |
| Community and open source | Community (`community`), Open source (`open_source`) |
| Partnerships and referral | Partnerships (`partnerships`, `integrations`), Referral and affiliate (`referral`) |

Three channels feed their own sections instead of a score: `traffic` (Site traffic), `martech` (Tech stack) and
`hiring` (collected only by older runs; not shown).

Inside each activity the content is also fixed by code (`scripts/proof.mjs`): which posts, ads or screenshots
belong to it, and which facts (plans, comparison pages, follower counts) sit beside it. Only the words are
written per company: the analyst writes one cited sentence per activity, picks the plays shown at the top, and
writes the takeaways.
