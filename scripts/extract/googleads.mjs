// Google ads from Firecrawl Alexandria adstransparency-google-com / list_ads, mapped by code.
import { alexandria, findRecords, field, isoDay, num } from '../lib/calls.mjs';

const GOOGLE = 'adstransparency-google-com';

export function extractGoogleAds(calls, ctx) {
  const ads = []; const skipped = []; const seen = new Set(); let total; let advertiser; let capturedAt; let firstCall;
  for (const call of calls) {
    for (const a of alexandria(call)) {
      if (a.provider !== GOOGLE) continue;
      const found = findRecords(a.result);
      const meta = a.result?.data && !Array.isArray(a.result.data) ? a.result.data : a.result;
      const t = num(field(meta, 'total', 'total_count', 'totalcount', 'count', 'total_ads'));
      if (/list_ads/i.test(a.capability) && t !== undefined) total = Math.max(total ?? 0, t);
      if (!/list_ads/i.test(a.capability) || !found) continue;
      const adv = field(a.options, 'advertiser_id', 'advertiserId', 'advertiser');
      advertiser ??= adv; capturedAt ??= isoDay(call.at); firstCall ??= call.ref;
      found.records.forEach((rec, i) => {
        const ref = `${call.ref}#${a.ptr}${found.ptr}/${i}`;
        const cid = field(rec, 'creative_id', 'creativeId', 'ad_id', 'id');
        const first = isoDay(field(rec, 'first_shown', 'first_shown_date', 'first_seen', 'start_date', 'first_served'));
        const last = isoDay(field(rec, 'last_shown', 'last_shown_date', 'last_seen', 'end_date', 'last_served'));
        if (!cid) { skipped.push({ call: ref, why: 'record has no creative id' }); return; }
        const recAdv = field(rec, 'advertiser_id', 'advertiserId') ?? adv;
        const url = field(rec, 'url', 'creative_url', 'link');
        const u = /^https?:\/\//.test(url ?? '') ? url : (recAdv ? `https://adstransparency.google.com/advertiser/${recAdv}/creative/${cid}?region=anywhere` : null);
        if (!u) { skipped.push({ call: ref, why: 'no link to the creative and no advertiser id to build one' }); return; }
        if (seen.has(u)) return;
        seen.add(u);
        let days = num(field(rec, 'days_shown', 'days_active', 'active_days', 'num_days_shown'));
        let basis;
        if (days === undefined && first && last) { days = Math.round((Date.parse(last) - Date.parse(first)) / 864e5) + 1; basis = 'span from first to last shown'; }
        if (days === undefined) { skipped.push({ call: ref, why: 'no days-shown count and no dates to work it out from' }); return; }
        const fmt = String(field(rec, 'format', 'ad_format', 'type') ?? '').toLowerCase();
        const image = field(rec, 'image_url', 'preview_url', 'thumbnail_url', 'creative_image_url');
        const headline = field(rec, 'headline', 'title');
        ads.push({
          platform: 'google', advertiser: field(rec, 'advertiser_name', 'advertiser') ?? undefined, format: /^(text|image|video)$/.test(fmt) ? fmt : undefined,
          days_shown: days, ...(basis ? { days_shown_basis: basis } : {}), ...(first ? { first_shown: first } : {}), ...(last ? { last_shown: last } : {}),
          image_url: /^https?:\/\//.test(image ?? '') ? image : null, width: num(field(rec, 'width')) ?? null, height: num(field(rec, 'height')) ?? null,
          url: u, ...(typeof headline === 'string' && headline ? { headline } : {}), raw_ref: ref,
        });
      });
    }
  }
  if (!ads.length && total === undefined) return { layer: 'paid', items: [], ads: [], skipped };
  const items = [];
  const advUrl = advertiser ? `https://adstransparency.google.com/advertiser/${advertiser}?region=anywhere` : (ads[0]?.url ?? 'https://adstransparency.google.com/');
  if (total !== undefined) items.push({ ref: 'auto-google-total', channel: 'google_ads', status: 'observed', finding: `Google's Ads Transparency Center lists ${total} ad${total === 1 ? '' : 's'} for ${ctx.brand ?? ctx.domain} (all regions).`, url: advUrl, raw_ref: firstCall });
  if (ads.length) {
    const running = capturedAt ? ads.filter((a) => a.last_shown && (Date.parse(capturedAt) - Date.parse(a.last_shown)) / 864e5 <= 2).length : null;
    const n = (f) => ads.filter((a) => a.format === f).length;
    const mix = ['text', 'image', 'video'].filter(n).map((f) => `${n(f)} ${f === 'text' ? 'search (text)' : f}`);
    items.push({
      ref: 'auto-google-sample', channel: 'google_ads', status: 'observed',
      finding: `${ads.length} ad${ads.length === 1 ? '' : 's'} retrieved (a sample, not necessarily all of them)${running !== null ? `; ${running} last shown within 2 days of the capture date` : ''}${mix.length ? `; ${mix.join(', ')}` : ''}.`,
      url: advUrl, raw_ref: firstCall,
    });
    for (const a of ads) a.evidence_ref = 'auto-google-sample';
  }
  return { layer: 'paid', items, ads, ...(total !== undefined ? { ads_total: { low: total, high: total } } : {}), skipped };
}
