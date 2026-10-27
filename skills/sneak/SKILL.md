---
name: sneak
description: Take a sneak peek at how a company grows. Give it a URL and it collects public evidence of the company's distribution (ads, social posts and their performance, SEO and AI-search readiness, comparison pages, customer proof, pricing and signup, press, events, partnerships, community, site traffic, tech stack), covers 17 growth activities, and renders a local HTML report with a short cited read per activity, the real posts, ads and page screenshots behind each one, and what we couldn't see. Use when the user says "/sneak <url>", "how does <company> grow", "sneak on <company>", "what's <company>'s distribution strategy", or "show me <company>'s ads and social".
argument-hint: <company url or domain>
---

# /sneak: how does this company grow?

You are the orchestrator. You do not write findings yourself; collectors gather evidence, the analyst
writes the read, and scripts do everything mechanical. Your job is to run the steps below in order,
in one go, without pausing for confirmation, and finish with the report open.

**The rules that matter:**
- Every claim and recommendation rests on cited evidence. Nothing is invented. Nothing is scored: the report says
  what we saw, with the proof.
- Never state that something is absent unless a recorded check found it absent. "We couldn't check" is always
  allowed and always honest, and is shown as "Not covered", never as 0.
- The report describes; it does not advise. The only prose written per company is the analyst's short read per
  activity, in the voice of `$P/references/voice.md`. It never judges the company ("weak", "failing"); the reader
  decides what to take from it.

How the report is organised (channels, the 18 activities, and the sections) is in
`$P/references/taxonomy.md`.

Paths below: `$P` is this plugin's root (`${CLAUDE_PLUGIN_ROOT}`; if that is not filled in, it is the folder two
levels above this SKILL.md), `$R` is `reports/<domain>/` in the user's current directory. Paths can contain
spaces: always quote them in commands (`"$P"`, `"$R"`).

## Tell the user what is happening
A run takes several minutes and most of it is agents working. Send one short line in chat at each step, in plain
words, so the user can see progress: "Step 1 of 5: free first-party checks (sitemap, robots, social links)",
"Step 2 of 5: four collectors running in parallel (paid, owned, social, company)", then one line as each
collector finishes ("Paid done: 63 Google ads, 6 Meta ads, 15 credits"), "Step 3 of 5: merging and checking the
evidence", "Step 4 of 5: writing the short reads", "Step 5 of 5: building the report". Keep each to one line. Do not narrate tool calls.

## Setup: sign in to the two connections (first run only)

Firecrawl and Exa are remote MCP servers that ship with this plugin (`firecrawl` and `exa`). They use browser
sign-in (OAuth), not API keys: the user signs in once and Claude Code stores the login. You never see credentials
and must never ask for them.

Before step 0, check that the connections work, by tool name and one cheap call:
- No tool ending in `firecrawl_scrape` in this session, or a Firecrawl call that fails with an auth error (401,
  "unauthorized", "invalid token"): Firecrawl is not signed in. Send the message below and stop. Do not start the
  run.
- Exa tools missing or failing with an auth error: carry on without Exa and say so in the closing message (step 6):
  founders' posts, press and reviews are thinner without it. Also add the Exa line from the message below.

> Growth Sneak uses two connections that you sign in to once, with no API keys.
> 1. Type `/mcp`, select **firecrawl**, and choose **Authenticate**. Sign in to Firecrawl in the browser and approve a team (free credits to start).
> 2. In `/mcp`, select **exa** and choose **Authenticate**. Sign in to Exa in the browser.
> 3. Restart Claude Code (or type `/reload-plugins`), then run `/sneak <company>` again.
> In the desktop app, open **Customize > Connectors**, or the plugin's **Connectors** tab, and use **Connect** on each one.
> If a same-named `firecrawl` or `exa` server is already set up under your own settings, it can shadow the plugin's. Run `claude mcp list` to check, and remove or rename yours. Run Claude Code from a folder other than the plugin's own source repo.

If the user pastes a key or token into the chat anyway, do not save it or repeat it back (not even partly). Tell
them it is now visible in this conversation and to revoke it. Never create an account for the user or open the
sign-up pages and fill them in.

## 0. Resolve and set up

1. Normalise the input to a bare domain (`https://www.exa.ai/pricing` -> `exa.ai`) and note the brand name.
2. If `$R` already exists from an earlier run, move it to `reports/.archive/<domain>-<date>/` first, so nothing
   from the old run (fragments, analysis) leaks into this one. Then create `$R/`, `$R/raw/`,
   `$R/fragments/`, `$R/assets/`.
3. **Site traffic costs 660 Firecrawl credits** (six months of Similarweb visits). Collect it only if the user
   asked for it ("with traffic") or said yes when asked. If they did not say, ask once now, before anything runs:
   "Include six months of site traffic from Similarweb? It costs about 660 Firecrawl credits." Record the answer as
   `"traffic": true|false` in `run.json`.
4. Work out which data tools this session actually has, by tool name (Alexandria is reached through Firecrawl: `firecrawl_find_tools`; see `$P/references/alexandria.md`):
   - **Firecrawl**: tools ending in `firecrawl_scrape`, `firecrawl_search`, `firecrawl_map`.
   - **Exa**: tools ending in `web_search_exa`.
   - **Apify**: tools from an Apify MCP server, or `APIFY_TOKEN` in the environment.
   - **Alexandria**: reached through Firecrawl (`firecrawl_find_tools`); it is available when Firecrawl is.
   Write `$R/run.json`:
   ```json
   { "domain": "exa.ai", "brand": "Exa", "captured_at": "<now, ISO>", "traffic": false, "sources": { "firecrawl": "connected|missing", "alexandria": "connected|missing", "exa": "...", "apify": "..." }, "cost": { "note": "" } }
   ```

5. **Start verbatim capture:** `node "$P/scripts/capture.mjs" --start "$R"`. From here until step 3 a plugin hook saves
   every Firecrawl and Exa response to `$R/raw/calls/` exactly as the tool returned it, with no model in between.
   Code (step 2b), not a collector, turns those files into the posts, ads, pricing and site blocks, so the report
   shows what the tools returned and not a model's retelling of it.

## 1. Free first-party collection (scripts, run in parallel)

These need no keys. Run them together and save their output:

```bash
node "$P/scripts/sitemap.mjs" <domain> > "$R/raw/sitemap.json"
node "$P/scripts/sitecheck.mjs" <domain> > "$R/raw/sitecheck.json"
node "$P/scripts/social.mjs" <domain> > "$R/raw/social.json"
```

`social.json` contains the company's own social accounts (from its homepage links and JSON-LD),
GitHub org stats, Discord member counts and Hacker News stories. The collectors build on it.

## 2. Four collectors, in parallel

Dispatch **four `sneak-collector` agents in one message**, one per layer: `paid`, `owned`, `social`,
`company`. Give each:
- the domain, the brand name, `$R`, `$P`
- which data tools are connected (from step 0), and for `owned` whether to collect traffic (`run.json`)
- its layer name (it reads `$P/references/layers/<layer>.md` for its brief)
- for `social`: the accounts list from `$R/raw/social.json`

**If the `sneak-collector` / `sneak-analyst` agent types are not available in this session** (for example
the plugin was loaded as plain files), do each role yourself in turn: read that agent's file and, for a
collector, its layer brief, then write the same output file. Do not skip a layer because the agent type is
missing. Use `Agent` with `subagent_type: general-purpose` and the agent file's text as the prompt if you can.

Tell each collector to follow `$P/references/alexandria.md` for any Alexandria call (discover first, know the price, never accept provider terms) and that the four of them share one Firecrawl key (about 10 requests a minute in
total), so they should batch calls, wait and retry once on a rate-limit error, and use `curl` for plain
pages. A rate-limited check that was not repeated is `couldnt_check`, never an absence.

Tell each collector: **do not write `posts`, `ads`, `ads_total`, `pricing`, `site`, `site_checks`, `oss`, `community`
or X and LinkedIn `accounts`**. Run the queries (the tool calls are saved for you) and code builds those blocks. They
write only what code cannot: items for judgment calls, checked absences with a probe, `couldnt_check`, and
`$R/judgments/<layer>.json` (who owns each account, what kind each post is). Every number in an item's `finding` must
come from a saved response, and the item lists those files in `cites`.

Each collector writes `$R/fragments/<layer>.json` in the fragment format in
`$P/references/data-format.md`, and saves any screenshots into `$R/assets/`. If one fails or times out,
re-dispatch that one layer once; if it fails again, continue without it (the report will show those
channels as "couldn't see").

## 2b. Extract (code, no model)

```bash
node "$P/scripts/extract.mjs" "$R"
```

This reads every saved response in `$R/raw/calls/` and the free scripts' files in `$R/raw/`, and writes
`$R/fragments/<layer>.auto.json`: posts, ads, pricing, the site, site checks, open source, community and accounts,
each with a `raw_ref` to its source. Read `$R/extract-report.json`:
- `calls: 0` means capture was not active. Say so in step 6: posts and ads are then not verified.
- `skipped` lists records the provider returned without a field we need (an id, a date, a count). They are left out,
  never guessed. If a whole provider is skipped, run `node "$P/scripts/extract.mjs" "$R" --inspect` to see the real
  shape and tell the user the mapping needs updating; do not hand-write the data instead.
- `unmapped_fields` lists fields a provider sent that no mapping reads (for example a nested count). A non-empty list
  means a number or date may be missing from the report: run `--inspect`, tell the user which field it is, and do not
  hand-write the missing data.
- `outside_window` lists posts older than `post_window_days` (default 120, set it in `run.json`). They are left out
  of the recent posts, not lost; mention the count in step 6.
- `owners_defaulted_to_team` lists accounts nobody classified. Re-dispatch that collector once to write its
  `judgments/<layer>.json`, then extract again.

## 3. Merge

Before merging, read each fragment's `couldnt_check` items. A layer that came back with only `couldnt_check`
items for a channel it should have reached (for example no Google result at all) is worth one re-run, because a
shared rate limit can cause it.

```bash
node "$P/scripts/merge.mjs" "$R"
```

Merge also checks every machine-made entry against the saved response it points at (every line of a post's text and
every count must appear in it) and fails if one does not. Hand-written `posts` and `ads` with no `raw_ref` are set aside
and listed. Then run `node "$P/scripts/capture.mjs" --stop`.

This assigns evidence ids (kept stable if you merge again after a fix), adds up every fragment's `credits` into
the run's cost, and checks every item the way the renderer will: channel, status, url, and that an absence has a
probe. If it reports an error, send it to the collector that owns that layer, have it fix its fragment, and merge
again; fix the fragment, never the script.

## 4. Analyst

Dispatch one `sneak-analyst` agent with `$R` and `$P`. It reads `$R/evidence.json` and writes `$R/analysis.json`:
the company name, one read per activity we saw, and the gaps. These are the only
words in the report written per company; everything else is built from the evidence. It does not collect anything
new.

## 5. Render and open

```bash
node "$P/scripts/render.mjs" "$R" --open
```

If the renderer prints warnings (uncited claims dropped, an unknown activity), that is the system
working; pass the list to the user. If it exits with an error, the data is broken: fix the named field
(usually via the analyst or the owning collector) and render again.

## 6. Tell the user

Reply in chat with:
- the report path (`$R/report.html`)
- two or three things that stand out from the reads (the activities with the most evidence)
- what wasn't covered and which missing source would cover it
- provenance, from `evidence.json` `provenance` and `extract-report.json`: how many posts and ads came verbatim from saved
  tool responses, how many hand-written entries were set aside, and which records were skipped for missing fields
- the run cost: Firecrawl credits (Alexandria calls included, with the providers used)
- if the Exa key was not set: one line saying so, with the link to get one

Do not paste the whole report into chat.

## Cost and limits

- A run without traffic costs about 75 to 110 Firecrawl credits in practice, which includes 5 for the Meta Ad
  Library lookup. Traffic adds 660 (110 per month), so a run with traffic is about 750. The optional Upspring
  lookup (estimates of Meta spend, mostly consumer brands) adds 150 and is only run if the user asks.
- Default collection caps: Google ads up to 200 (5 pages), X posts 10 per account (Firecrawl's provider
  limit), LinkedIn posts up to 40 per account. There is no total cost cap; report what was spent.
- Alexandria calls are billed at each capability's published price. Discovery is free. Report what was spent and which providers were used. Providers that need terms accepted are skipped; never accept terms for the user.
- Never sign in to anything, never create accounts, and never scrape behind a login.
- LinkedIn and X scraping through Apify is opt-in: only if the user has an Apify connection. Respect
  each platform's terms; prefer official or public endpoints.
