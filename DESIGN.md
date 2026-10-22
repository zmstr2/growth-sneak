# Design

The report is a single local HTML page (`templates/report.html`, filled by `scripts/render.mjs`). This file
describes how it looks and why. The structure is in `references/taxonomy.md`.

## Layout
- A fixed contents list on the left; it highlights the section in view.
- The report column on the right, about 960px wide. Designed for desktop.
- Order: Overview, Site traffic, the nine activity sections, Tech stack, What we could not see. No footer.

## Overview
The company's logo (its favicon) and name, then the domain and capture date. Nothing else: no headline, no summary
cards, no advice. The reader goes straight to the activity sections and decides what to take from them.

## An activity block
Each section is a white card; each activity inside it is a lightly shaded panel, and the proof sits on white inside
the panel, so there are three quiet levels and no heavy borders. Top to bottom:
- the activity name with a small pill only when it matters ("Checked, none found" or "Not covered"). A section with
  one activity named like itself shows no second heading. A gap is one dashed line, not a full panel.
- one cited sentence;
- the proof, full width: key facts as small label-over-value tiles, ratings and link pills, a table for pieces of
  content (type, title, outlet or author, date, newest first), the AEO checklist as small tiles, and a
  sideways-scrolling row of posts, ads (drawn like Meta draws them) and page screenshots that enlarge on click;
- sources as small links, only where nothing above links to the original.

Organic social opens with one compact chip per account: platform mark, handle, follower count and a small
Company, Founder or Team tag. Details sit in the chip's tooltip.

## Visual system
- Light gray page (#f4f4f4), white panels with hairline borders and soft shadows.
- Inter for text, Bricolage Grotesque for headings and numbers.
- Colour is kept for meaning: green only for the traffic chart; gray otherwise. Platform marks use the platform's
  own colour. No red: the report describes, it does not flag weaknesses.
- Type sizes 13, 15, 17, 20 and 28px; muted text at least 4.5:1.

## Honesty in the design
- Every sentence written per company carries sources; uncited ones are dropped before render.
- Not covered is never "none found". Only a recorded check can say "Checked, none found", and it shows what was checked.
- Estimates (Similarweb traffic, Upspring spend) are labelled as estimates with their source.
- A post with no readable numbers says "Engagement not visible".
- Each post, ad and screenshot appears once.

## Technical
- One file: page screenshots embedded, one inline script allowed by a content-security-policy hash, no external
  scripts. Fonts, favicons, and ad and post preview images load from their own hosts; system fonts are the fallback.
- The script only does the contents highlight, the screenshot zoom, the sideways scroll arrows and inline source
  lists.
