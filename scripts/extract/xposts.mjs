// X posts from Firecrawl Alexandria x-com / users/posts, mapped by code from the captured response.
import { alexandria, findRecords, field, isoDay, num, norm } from '../lib/calls.mjs';
import { fmtDate, listJoin } from '../util.mjs';

const ID = ['id', 'tweet_id', 'post_id', 'status_id', 'rest_id'];
const TEXT = ['text', 'full_text', 'content', 'body'];
const WHEN = ['created_at', 'created', 'date', 'published_at', 'published', 'timestamp', 'time'];
const LIKES = ['likes', 'like_count', 'favorite_count', 'favorites'];
const REPOSTS = ['reposts', 'retweets', 'retweet_count', 'repost_count'];
const REPLIES = ['replies', 'reply_count', 'comments', 'comment_count'];
const VIEWS = ['views', 'view_count', 'impressions'];
const FOLLOWERS = ['followers', 'followers_count', 'author_followers', 'author_followers_count'];

export function extractXPosts(calls, ctx) {
  const posts = []; const items = []; const accounts = []; const skipped = []; const seen = new Set();
  const byHandle = new Map();
  for (const call of calls) {
    for (const a of alexandria(call)) {
      if (a.provider !== 'x-com' || !/post/i.test(a.capability)) continue;
      const handle = String(a.options.username ?? a.options.handle ?? '').replace(/^@/, '');
      const found = findRecords(a.result);
      if (!handle || !found) { skipped.push({ call: call.ref, why: handle ? 'no records in the response' : 'no username in the request' }); continue; }
      found.records.forEach((rec, i) => {
        const id = field(rec, ...ID); const text = field(rec, ...TEXT); const published = isoDay(field(rec, ...WHEN));
        const ref = `${call.ref}#${a.ptr}${found.ptr}/${i}`;
        if (id == null || typeof text !== 'string' || !published) { skipped.push({ call: ref, why: 'record is missing its id, text or date' }); return; }
        const url = field(rec, 'url', 'permalink', 'link');
        const u = /^https?:\/\//.test(url ?? '') ? url : `https://x.com/${handle}/status/${id}`;
        if (seen.has(u)) return;
        seen.add(u);
        const metrics = {};
        for (const [k, names] of [['likes', LIKES], ['reposts', REPOSTS], ['replies', REPLIES], ['views', VIEWS]]) { const n = num(field(rec, ...names)); if (n !== undefined) metrics[k] = n; }
        const isReply = Boolean(field(rec, 'is_reply', 'in_reply_to_status_id', 'in_reply_to_user_id', 'in_reply_to_screen_name'));
        const kind = ctx.kindOf(u);
        const owner = ctx.ownerOf(handle, 'x');
        posts.push({
          platform: 'x', account: handle, owner, url: u, published, text,
          ...(Object.keys(metrics).length ? { metrics } : {}), ...(isReply ? { reply: true } : {}), ...(kind ? { kind } : {}),
          evidence_ref: `auto-x-${handle.toLowerCase()}`, raw_ref: ref,
        });
        const g = byHandle.get(handle.toLowerCase()) ?? { handle, owner, dates: [], call: call.ref, followers: undefined };
        g.dates.push(published);
        const f = num(field(rec, ...FOLLOWERS));
        if (g.followers === undefined && f !== undefined) g.followers = f;
        byHandle.set(handle.toLowerCase(), g);
      });
    }
  }
  for (const g of byHandle.values()) {
    const n = posts.filter((p) => p.account.toLowerCase() === g.handle.toLowerCase()).length;
    const d = [...g.dates].sort();
    const range = d[0] === d.at(-1) ? fmtDate(d[0]) : `${fmtDate(d[0])} to ${fmtDate(d.at(-1))}`;
    items.push({
      ref: `auto-x-${g.handle.toLowerCase()}`, channel: g.owner === 'founder' ? 'founder_social' : 'social', status: 'observed',
      finding: `A ${n}-post sample of @${g.handle} on X (${range}), with the counts the provider returned.`,
      url: `https://x.com/${g.handle}`, raw_ref: g.call,
    });
    accounts.push({ platform: 'x', handle: g.handle, url: `https://x.com/${g.handle}`, owner: g.owner, ...(g.followers !== undefined ? { followers: g.followers } : {}), evidence_ref: `auto-x-${g.handle.toLowerCase()}`, raw_ref: g.call });
  }
  return { layer: 'social', posts, items, accounts, skipped };
}
void norm; void listJoin;
