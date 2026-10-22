# Layer: company

Channels: `martech`, `referral`. (Hiring is not collected: the report does not show it.)

## Tech stack (rendered visit, 1-5 credits)
`firecrawl_scrape` the homepage with `formats: ["markdown"]` (**do not request rawHtml or html**: they add
over a megabyte and overflow the tool result) and these actions:
```json
[{"type":"wait","milliseconds":6000},{"type":"scroll","direction":"down"},{"type":"wait","milliseconds":2000},
 {"type":"executeJavascript","script":"(() => { const hosts = {}; for (const e of performance.getEntriesByType('resource')) { try { const h = new URL(e.name).hostname; hosts[h] = (hosts[h] || 0) + 1; } catch (_) {} } const scripts = [...document.scripts].map(s => s.src).filter(Boolean).map(s => { try { return new URL(s).hostname } catch(_) { return '' } }); const globals = ['dataLayer','gtag','analytics','amplitude','mixpanel','posthog','heap','Intercom','fbq','_linkedin_partner_id','lintrk','ttq','uetq','rdt','twq','hj','clarity','Statsig','optimizely','ldclient','OneTrust','Osano','transcend','Sentry','DD_RUM','hbspt','Marketo','drift','qualified','ChiliPiper','_6si','clearbit','Cookiebot','rb2b','reb2b'].filter(k => typeof window[k] !== 'undefined'); return JSON.stringify({hosts, scriptHosts: [...new Set(scripts)], globals}); })()"}]
```
The script's return value is in `actions.javascriptReturns[0].value`, a JSON string. Save that string to
`$R/raw/tech-visit.json` (the whole scrape result also works), then run
`node $P/scripts/techstack.mjs $R/raw/tech-visit.json <domain>`. It prints `tools`, `unknown_hosts` and
`notes`. Write the `tech` block from `tools` and `notes` only (leave out `unknown_hosts`; extra keys are
rejected) and one `martech` item listing what loaded. An affiliate tool (Tolt, Rewardful, PartnerStack,
FirstPromoter, impact.com) is also an `observed` item on `referral`.

## Referral and affiliate
A public referral or affiliate page: record its terms, quoted. Before writing an absence, check all of these
and name them in the `probe`: the footer and menu links on the homepage (look for "Referral", "Refer a friend",
"Affiliates", "Partners"), every sitemap URL containing `refer`, `affiliat` or `partner` (for example
`/referral-details`), and `/affiliates`, `/partners`, `/referral`. A redirect to a marketing page is not proof
that no program exists. Referral (customers refer customers) and affiliate (paid partners) are different
programs: record each on its own.
