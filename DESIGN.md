# Design

The report is a single local HTML page (`templates/report.html`, filled by `scripts/render.mjs`). This file
describes how it looks and why. The structure is in `references/taxonomy.md`.

## Layout
- A fixed contents list on the left; it highlights the section in view.
- The report column on the right, about 960px wide. Designed for desktop.
- Order: Overview, What you can take from this, Site traffic, the nine activity sections, Tech stack, What we
  could not see, footer (sources used, scoring model, cost).

## Overview
The company's logo (its favicon) and name, the domain and capture date, then the analyst's one-line headline. Below
it, up to six cards for the strongest growth plays: activity name, score, one cited sentence, "See details". The
analyst chooses the plays by judgement; without a choice the renderer uses the takeaways' activities, then the
highest non-hygiene scores, at most two per section.

## An activity block
Two columns:
- **Left:** the activity name, the score out of 100 with a thin bar, and a note when needed ("Low confidence",
  "Checked, none found", "Nothing found in what we collected"). Not covered shows the words and a dashed bar,
  never a number.
- **Right, top to bottom:** the cited sentence; a key-facts panel of labelled rows (plans, comparison pages,
  active Meta ads...); the AEO checklist where it applies; a sideways-scrolling row of examples (posts styled like
  the platform they came from, ad creatives, page screenshots that enlarge on click); the sources as small links.

Organic social opens with one card per account (platform, handle, company or founder, followers, posts sampled,
typical engagement, latest post).

## Visual system
- Light gray page (#f4f4f4), white panels with hairline borders and soft shadows.
- Inter for text, Bricolage Grotesque for headings and numbers.
- Colour is kept for meaning: green for a score of 70 or more; gray otherwise. Platform marks use the platform's
  own colour. No red: the report describes, it does not flag weaknesses.
- Type sizes 13, 15, 17, 20 and 28px; muted text at least 4.5:1.

## Honesty in the design
- Every sentence written per company carries sources; uncited ones are dropped before render.
- Not covered is never 0. A checked absence is a labelled 0.
- Estimates (Similarweb traffic, Upspring spend) are labelled as estimates with their source.
- A post with no readable numbers says "Engagement not visible".
- Each post, ad and screenshot appears once.

## Technical
- One file: page screenshots embedded, one inline script allowed by a content-security-policy hash, no external
  scripts. Fonts, favicons, and ad and post preview images load from their own hosts; system fonts are the fallback.
- The script only does the contents highlight, the screenshot zoom, the sideways scroll arrows and inline source
  lists.
