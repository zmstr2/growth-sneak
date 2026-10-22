---
name: sneak
description: Take a sneak peek at how a company grows. Give it a URL and it collects public evidence of the company's distribution (ads, social posts and their performance, SEO and AI-search readiness, comparison pages, customer proof, pricing and signup, press, events, partnerships, community, site traffic, tech stack), scores 17 growth activities from 0 to 100, and renders a local HTML report with their strongest plays, the real posts, ads and page screenshots behind each score, moves a founder or growth lead can borrow, and what we couldn't see. Use when the user says "/sneak <url>", "how does <company> grow", "sneak on <company>", "what's <company>'s distribution strategy", or "show me <company>'s ads and social".
argument-hint: <company url or domain>
---

# /sneak: how does this company grow?

You are the orchestrator. You do not write findings yourself; collectors gather evidence, the analyst
writes the read, and scripts do everything mechanical. Your job is to run the steps below in order,
in one go, without pausing for confirmation, and finish with the report open.

**The rules that matter:**
- Every claim, score and recommendation rests on cited evidence. Nothing is invented.
- Never state that something is absent unless a recorded check found it absent. "We couldn't check" is always
  allowed and always honest, and is shown as "Not covered", never as 0.
- Commentary and recommendations are welcome, but only in the analyst's short reads and takeaways, written in
  the voice of `$P/references/voice.md` and drawn from `$P/references/plays.md`. They speak to a founder or
  growth lead who wants to borrow a move; they never judge the company ("weak", "failing").

How the report is organised (channels, the 17 scored activities, and the sections) is in
`$P/references/taxonomy.md`.

Paths below: `$P` is this plugin's root (`${CLAUDE_PLUGIN_ROOT}`; if that is not filled in, it is the folder two
levels above this SKILL.md), `$R` is `reports/<domain>/` in the user's current directory. Paths can contain
spaces: always quote them in commands (`"$P"`, `"$R"`).

## Tell the user what is happening
A run takes several minutes and most of it is agents working. Send one short line in chat at each step, in plain
words, so the user can see progress: "Step 1 of 6: free first-party checks (sitemap, robots, social links)",
"Step 2 of 6: four collectors running in parallel (paid, owned, social, company)", then one line as each
collector finishes ("Paid done: 63 Google ads, 10 credits"), "Step 3 of 6: merging and checking the evidence",
"Step 4 of 6: scoring 17 activities", "Step 5 of 6: writing the headline and takeaways", "Step 6 of 6: building the
report". Keep each to one line. Do not narrate tool calls.

## 0. Resolve and set up

1. Normalise the input to a bare domain (`https://www.exa.ai/pricing` -> `exa.ai`) and note the brand name.
2. If `$R` already exists from an earlier run, move it to `reports/.archive/<domain>-<date>/` first, so nothing
   from the old run (fragments, analysis, scores) leaks into this one. Then create `$R/`, `$R/raw/`,
   `$R/fragments/`, `$R/assets/`.
3. **Site traffic costs 660 Firecrawl credits** (six months of Similarweb visits). Collect it only if the user
   asked for it ("with traffic") or said yes when asked. If they did not say, ask once now, before anything runs:
   "Include six months of site traffic from Similarweb? It costs about 660 Firecrawl credits." Record the answer as
   `"traffic": true|false` in `run.json`.
4. Work out which data tools this session actually has, by tool name (Alexandria is reached through Firecrawl: `firecrawl_find_tools`; see `$P/references/alexandria.md`):
   - **Firecrawl**: tools ending in `firecrawl_scrape`, `firecrawl_search`, `firecrawl_map`.
   - **Exa**: tools ending in `web_search_exa` (works without a key on the free tier).
   - **Apify**: tools from an Apify MCP server, or `APIFY_TOKEN` in the environment.
   - **Alexandria**: reached through Firecrawl (`firecrawl_find_tools`); it is available when Firecrawl is.
   - **TypeSafe (Jev) scoring**: available when the `TYPESAFE_API_KEY` environment variable is set. Check with
     `[ -n "$TYPESAFE_API_KEY" ]`; never print or store the value.
   Write `$R/run.json`:
   ```json
   { "domain": "exa.ai", "brand": "Exa", "captured_at": "<now, ISO>", "traffic": false, "sources": { "firecrawl": "connected|missing", "alexandria": "connected|missing", "exa": "...", "apify": "...", "typesafe": "key set|missing" }, "cost": { "note": "" } }
   ```

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

Each collector writes `$R/fragments/<layer>.json` in the fragment format in
`$P/references/data-format.md`, and saves any screenshots into `$R/assets/`. If one fails or times out,
re-dispatch that one layer once; if it fails again, continue without it (the report will show those
channels as "couldn't see").

## 3. Merge

Before merging, read each fragment's `couldnt_check` items. A layer that came back with only `couldnt_check`
items for a channel it should have reached (for example no Google result at all) is worth one re-run, because a
shared rate limit can cause it.

```bash
node "$P/scripts/merge.mjs" "$R"
```

This assigns evidence ids (kept stable if you merge again after a fix), adds up every fragment's `credits` into
the run's cost, and checks every item the way the renderer will: channel, status, url, and that an absence has a
probe. If it reports an error, send it to the collector that owns that layer, have it fix its fragment, and merge
again; fix the fragment, never the script.

## 3b. Score the activities (optional key)

```bash
node "$P/scripts/score.mjs" "$R"
```

If `TYPESAFE_API_KEY` is set (the user's own TypeSafe key, read only from the environment, never stored), this
scores every growth activity from the evidence with the Jev model and writes `$R/scores.json`. Without a key it
prints a note and writes nothing; the analyst then gives each activity a level on the same rubric
(`activity_levels`). Never ask the user to paste a key into a file; tell them to set the environment variable.

If there is no key, nothing is written yet: the analyst gives each activity a level in step 4, then step 4b writes the scores.

## 4. Analyst

Dispatch one `sneak-analyst` agent with `$R` and `$P`. It reads `$R/evidence.json` (and `$R/scores.json` when it exists) and writes
`$R/analysis.json`: the headline, one read per scored activity, the plays to feature, 2 to 4 takeaways and the gaps (plus `activity_levels` when there is no key). These are the only words in the report written per company; everything else is built from the evidence. It does not collect anything new.

## 4b. Finish the scores (only if there was no key)

```bash
node "$P/scripts/score.mjs" "$R"
```

With no key, this reads the analyst's `activity_levels` and writes `$R/scores.json` (levels on the same rubric,
no confidence). With a key, step 3b already wrote it and there is nothing to do.

## 5. Render and open

```bash
node "$P/scripts/render.mjs" "$R" --open
```

If the renderer prints warnings (uncited claims dropped, a takeaway that copies a play card, an unknown activity), that is the system
working; pass the list to the user. If it exits with an error, the data is broken: fix the named field
(usually via the analyst or the owning collector) and render again.

## 6. Tell the user

Reply in chat with:
- the report path (`$R/report.html`)
- the headline from `analysis.json`
- the plays featured at the top with their scores, and the takeaways
- what wasn't covered and which missing source would cover it
- the run cost: Firecrawl credits (Alexandria calls included, with the providers used) and whether Jev scoring ran

Do not paste the whole report into chat.

## Cost and limits

- A run without traffic costs about 70 to 100 Firecrawl credits in practice. Traffic adds 660 (110 per month),
  so a run with traffic is about 750. The Upspring Meta lookup adds 150 when the brand is in its data and
  nothing when it is not.

- Default collection caps: Google ads up to 200 (5 pages), X posts 10 per account (Firecrawl's provider
  limit), LinkedIn posts up to 40 per account. There is no total cost cap; report what was spent.
- Alexandria calls are billed at each capability's published price. Discovery is free. Report what was spent and which providers were used. Providers that need terms accepted are skipped; never accept terms for the user.
- Never sign in to anything, never create accounts, and never scrape behind a login.
- LinkedIn and X scraping through Apify is opt-in: only if the user has an Apify connection. Respect
  each platform's terms; prefer official or public endpoints.
