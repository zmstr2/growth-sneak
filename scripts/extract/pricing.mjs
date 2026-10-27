// A pricing page read by Firecrawl with JSON extraction. The extraction asks for a fixed shape; this copies that shape.
import { field, norm } from '../lib/calls.mjs';

const PLAN = ['name', 'price', 'unit', 'cta', 'free_trial', 'audience', 'key_points'];

export function extractPricing(calls) {
  for (const call of calls) {
    if (!/firecrawl_scrape$/.test(call.tool) || call.args?.alexandria) continue;
    const root = call.json?.json ?? call.json?.data?.json ?? call.json;
    const plans = root && Array.isArray(root.plans) ? root.plans : null;
    if (!plans || !plans.length || !plans.every((p) => p && p.name && p.price)) continue;
    const url = call.args.url;
    if (!/^https?:\/\//.test(url ?? '')) continue;
    const cleanPlans = plans.map((p) => Object.fromEntries(PLAN.filter((k) => p[k] !== undefined).map((k) => [k, p[k]])));
    const names = cleanPlans.map((p) => p.name);
    return {
      layer: 'owned',
      items: [{ ref: 'auto-pricing', channel: 'pricing_signup', status: 'observed', finding: `The pricing page lists ${names.length} plan${names.length === 1 ? '' : 's'}: ${names.map((n, i) => `${n} (${cleanPlans[i].price})`).join(', ')}.`, url, raw_ref: call.ref }],
      pricing: { billing: field(root, 'billing', 'billing_shown') ?? null, plans: cleanPlans, add_ons: Array.isArray(root.add_ons) ? root.add_ons : [], evidence_ref: 'auto-pricing', raw_ref: call.ref },
      skipped: [],
    };
  }
  return { layer: 'owned', items: [], skipped: [] };
}
void norm;
