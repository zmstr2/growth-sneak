# Layer: social

Channels: `social` (company accounts), `founder_social`, `community`, `open_source`, `video`,
`press_podcasts`, `events`, `partnerships`, `reviews`.

Start from `$R/raw/social.json`: the company's own accounts (from its homepage), GitHub stats, Discord
counts and Hacker News stories. Turn those into `accounts`, `oss` and `community` blocks with items.

## Find the founders and execs
Use Exa (`web_search_exa`) for "<company> co-founder CEO LinkedIn and X profile". Record the founders'
LinkedIn and X handles, and follower counts when a profile result shows them (item `observed`, with the
profile url).

If a founder has no X handle or LinkedIn profile you can find, write one `couldnt_check` item on
`founder_social` saying so; do not substitute a different person or a third-party aggregator's numbers.

## Posts (the core of this layer)
For each company account and each founder (X and LinkedIn):
- **X:** Firecrawl Alexandria `x-com` / `users/posts` with `{ "username", "limit": 10, "from_date", "to_date" }`
  (last 90 days). 30 credits per account. It returns a sample, at most 10 posts: say so in the item.
- **LinkedIn:** Exa search "LinkedIn posts by <company> (company page) in the last 3 months" often returns
  the company profile with recent posts and reaction counts. Use those numbers as shown.
- **Apify (only if connected):** `harvestapi/linkedin-company-posts`, `harvestapi/linkedin-profile-posts`,
  or an X scraper, capped at 40 posts per account.
- Normalise each post to the post shape in data-format.md. Set `kind` from the content (launch,
  partnership, event, research, hiring, stunt, milestone, other). Set `paid: true` only when the post
  itself carries evidence (e.g. `utm_medium=paid` in its link), and write an item saying what you saw.
- One item per account sample ("A 10-post sample of @ExaAILabs on X, 8-19 Oct") that the posts reference.
- Founders' own numbers ("we passed $100m ARR") are `stated` items on `founder_social`, quoted.

## Engagement numbers (the report shows them on each post)
Posts are drawn as cards with their likes, reposts and comments, so numbers matter. For the posts you would
feature (the company's and each founder's most recent 8 to 10, and any post a finding quotes):
- Exa search snippets often carry no counts. Open the post itself (`web_fetch_exa`, or `firecrawl_scrape` of
  the post URL, or the `x-com` provider for X) and read the numbers off the page.
- Record the numbers only if you can see them. A login wall, a hidden count or an unreadable page means
  **leave `metrics` out** of that post; the report then says "engagement not visible". Never estimate, and
  never copy a count from a different post.
- Keep the post's exact text in `text` (the report quotes it and highlights the quoted words), and note when
  Exa labels it "Reshared".
- Founders matter most: their own posts are usually the biggest performers, so try the hardest for them.

## Community, open source, video, press, events, partnerships
- Discord/Slack/forum size from `social.json` or the invite page. Reddit: try
  `https://www.reddit.com/search.json?q=url:<domain>`; a 403 is `couldnt_check`.
- GitHub: top repos with stars and last push, from `social.json`.
- YouTube: if the site links a channel, use Exa to find recent videos and view counts; otherwise
  `couldnt_check`.
- Press and podcasts: Exa search for interviews and coverage from the last 90 days, one item each. Older
  coverage may be mentioned in one extra item, clearly labelled as outside the window.
- Events and webinars: from posts and `/webinars` or `/events` pages.
- Partnerships and marketplaces: from posts, the pricing page and integration pages.
- Reviews (G2, Capterra, Trustpilot, app stores): Exa `site:` searches; record rating and review count
  only if shown. Otherwise `couldnt_check`.

## The `earned` and `ratings` blocks (shown as tables and pills)
Besides the items above, list every piece you found, one row each, so the report can show them as a table:
`"earned": { "items": [{ "title": "<headline or event name>", "url": "<deep link>", "kind": "press|article|podcast|award|video|webinar|conference|event", "outlet": "<publisher, show, or venue>", "date": "YYYY-MM-DD", "upcoming": true }], "evidence_ref": "<the press item's ref>" }`.
Press, articles, podcasts, awards and videos fill Press and podcasts; webinars, conferences and events fill Events and
webinars (include upcoming ones with `upcoming: true`). Keep each title as written, `outlet` short, and leave `date`
out when the page shows none. Older pieces are fine here; the table sorts newest first and shows 12.
`"ratings": { "items": [{ "source": "Capterra", "rating": 4.6, "count": 157, "url": "<the listing>" }], "evidence_ref": "<the reviews item's ref>" }`:
one entry per review site or app store whose page showed a rating; `count` only if shown. Different sources are not
averaged. You write both blocks in the `social` layer; the `owned` layer never writes them.

## When the homepage gives no accounts
`$R/raw/social.json` has an empty `accounts` list when the homepage is rendered by JavaScript. Then find the
accounts yourself, cheaply and in this order, before spending Firecrawl credits on any post query:
1. the company's GitHub org profile (its profile page lists the X handle and website)
2. an Exa search for `"<brand>" site:linkedin.com/company` and `"<brand>" site:x.com`
3. the footer links on a scraped docs or blog page
Confirm a handle belongs to the company (same website or name on the profile) before querying posts. An
aggregator's handle that you have not confirmed is not a handle; a wrong guess can cost 30 or more credits.

## Recording follower counts and LinkedIn posts
- Say where a follower number came from and its date in the item's finding ("16,736 followers on an Exa
  profile result dated 2025"). The report cannot tell a fresh number from a stale one unless you say so.
- LinkedIn posts: use the post URL the provider returned. If you only have the activity id, use
  `https://www.linkedin.com/feed/update/urn:li:activity:<id>` and say in the finding that you did not open it.
- A post that the provider labels "Reshared" is not the company's own words; say so in the finding.

## More social sources through Alexandria (optional)
Read `references/alexandria.md`. `x-com` (X posts and accounts), `youtube-com` (channel videos, view counts and
upload dates: this fills the YouTube gap), and `oriane` (TikTok and Instagram, only if the company has an account there: run `instagram/posts-search` or
`tiktok/posts-search` with the exact `handle`, `sort: "likesCount:desc"` (TikTok: `viewsCount:desc`), `limit: 6`,
`projection: "default"`, about 30 credits and free when the index has nothing; each result also carries the
profile's `profileFollowersCount`, `profilePostsCount` and `profileUrl`). Map each result to a `posts` entry
(`platform` instagram or tiktok, `account` = handle, `owner`, `url` = `postUrl`, `published`, `text` = caption,
`metrics` { likes, comments, views, shares }, `thumbnail_url` = `thumbnailMediaUrl`) and the profile to an `accounts`
entry with `followers`. Discover first and read each contract and price. Posts go in `posts` as before;
a channel's upload dates and views go in a `video` item.

## Sources and replies
- **No mirror sites.** Never cite third-party copies of X or other platforms (xitter, nitter, 24vids and the
  like). Cite the platform's own page. If only a mirror shows a number, leave the number out.
- **Replies are not posts.** A reply to a commenter ("Sent, check your DMs!") goes in `posts` only with
  `"reply": true`, and is never shown as one of their best posts. Prefer the account's own original posts.
- **Use the platform's own metric names:** X `likes`, `reposts`, `replies`, `views`; LinkedIn `reactions`,
  `comments`, `reposts`; Instagram `likes`, `comments`, `views`; TikTok `views`, `likes`, `comments`, `shares`;
  YouTube `views`. Merge maps common mistakes (LinkedIn "likes" become reactions) and drops keys the platform
  does not have.
