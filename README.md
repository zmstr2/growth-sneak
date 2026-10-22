# Growth Sneak

See how any company grows, with the proof.

```
/sneak clay.com
```

![Scrolling through a Growth Sneak report on clay.com: accounts, posts, ads, content tables, pricing and more](docs/img/scroll.gif)

*A sample report on clay.com. Every number and quote links to its source.*

Growth Sneak is a Claude Code plugin for founders and growth leads. Give it a company's URL. It collects public
evidence of how that company gets customers across 18 growth activities, and opens one local HTML report:

- **Overview**: the company, its domain and when the data was collected
- **Site traffic**: six months of estimated monthly visits (Similarweb)
- **Nine sections**: organic social, SEO and AEO, owned content, earned content, paid social, paid search, signup
  and pricing, community and open source, partnerships and referral. Each activity shows what we saw, one cited
  sentence, the real posts, ads, tables or page screenshots behind it, a few key facts, and links to its sources
- **Tech stack** and **what we could not see**

Every claim links to its source. Anything we could not check is marked "Not covered", never guessed and never
shown as 0. The sections and activities are the same for every company (see `references/taxonomy.md`), so two
reports can be compared side by side.

## Install

In Claude Code:

```
/plugin marketplace add zmstr2/growth-sneak
/plugin install growth-sneak@growth-sneak
```

Then restart Claude Code and run `/sneak <company url>`. The first run asks for two API keys (below). To work on the
plugin itself, clone the repo and start Claude Code with `claude --plugin-dir /path/to/growth-sneak`.

## First run: two API keys

Growth Sneak reads pages and searches the web through two services. Both have free credits to start:

| Service | What it does here | Get a key |
|---|---|---|
| **Firecrawl** | Google and Meta ads, page screenshots, pricing, the rendered tech stack, X posts, data providers | https://www.firecrawl.dev/app/api-keys (starts with `fc-`) |
| **Exa** | founders' posts, press, reviews, events, community | https://dashboard.exa.ai/api-keys |

The first time you run `/sneak`, it asks for both keys, saves them to the `env` block of `~/.claude/settings.json`
(your computer only, file readable by you alone) and tells you to restart Claude Code. If you would rather not
paste keys into the chat, export `FIRECRAWL_API_KEY` and `EXA_API_KEY` in your shell profile instead. You can also
run the helper yourself: `node scripts/setup.mjs check | save | verify`. Keys are never written into the plugin or
a report.

## Other data sources (optional)

| Source | Setup | What it adds |
|---|---|---|
| Free scripts | nothing | sitemap, robots.txt, llms.txt, GitHub, Discord, Hacker News, ad-library links |
| Apify | connect the Apify MCP server | fuller LinkedIn and X post history (opt-in; respect each platform's terms) |

**Firecrawl Alexandria** is a catalogue of data providers reached through your Firecrawl connection. Growth Sneak
uses Google's Ads Transparency data, Similarweb (traffic) and Oriane (Instagram and TikTok, where indexed). It always looks up a provider's price before calling it,
reports what it spent, and never accepts a provider's terms for you.

**Paid social.** Meta ads come from Meta's public Ad Library, read through Firecrawl (5 credits). LinkedIn's and
TikTok's libraries block automated reads, so the report links to them and marks them "Not covered".

**Cost.** In real runs, a report without traffic cost 72 to 81 Firecrawl credits, plus 5 for Meta ads. Six months of
Similarweb traffic adds 660 (about 750 in total), so Growth Sneak asks before collecting it (or say "with traffic").
The report's footer shows what the run spent. A run takes a few minutes.

## How it works

```
/sneak  ->  free scripts (sitemap, site checks, social links)
        ->  4 collector agents in parallel (paid, owned, social, company)  -> fragments/
        ->  scripts/merge.mjs   -> evidence.json  (every fact, with its source)
        ->  analyst agent       -> analysis.json  (one cited sentence per activity, and the gaps)
        ->  scripts/render.mjs  -> report.html
```

Collectors only record facts with links. Nothing is scored: code works out, per activity, whether we saw it,
checked and found none, or could not look (`scripts/coverage.mjs`). The analyst writes the only per-company prose. The renderer enforces the honesty rules in code: an uncited sentence is dropped, an unknown evidence id
stops the build, "not found" needs a recorded check, and posts show their real numbers or "engagement not
visible".

Reports are saved in `reports/<domain>/` in your current folder.

## Privacy

Growth Sneak reads only public pages and public data. It never signs in, creates accounts or fills in forms. Page
content goes to the data providers you connect (Firecrawl, Exa). The report is one local HTML file. Screenshots are saved inside it; fonts, the company's favicon, and
ad and post preview images load from their own hosts (Google Fonts, Google's ad servers, Meta and other
platforms' image servers) when you open it.

## Development

```bash
npm test                                          # no dependencies, Node 20+
node scripts/render.mjs tests/fixtures/exa.ai     # render the sample report
```

`DESIGN.md` describes the report's design. `docs/design-log.md` is the working log from building it.

MIT licensed.
