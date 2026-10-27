// Check the ledger against the saved tool responses. Machine-made entries must point at a real saved response and, for
// posts, match it (every line of text and every count appears in the source record). Hand-written items that cite a
// file get a softer check: numbers in the finding should appear in what they cite.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadCalls, pointer, corpusOf, norm } from './lib/calls.mjs';
import { parseExaResults } from './extract/exa.mjs';

const numsIn = (s) => new Set([...String(s).matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => Number(m[0].replace(/,/g, ''))));
// Numbers in a finding that are not data: years, "last 90 days", dates like "27 Oct 2026".
const dataNumsIn = (s) => numsIn(String(s).replace(/\b(?:19|20)\d{2}(?:-\d{2}){0,2}\b/g, ' ').replace(/\b\d+[- ](?:days?|months?|weeks?|years?)\b/gi, ' ').replace(/\b\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/g, ' '));
const leaves = (v, out = []) => { if (v == null) return out; if (typeof v === 'string') out.push(v); else if (typeof v === 'number') out.push(String(v)); else if (typeof v === 'object') for (const x of Object.values(v)) leaves(x, out); return out; };

export function verifyProvenance(dir, ev) {
  const calls = new Map(loadCalls(dir).map((c) => [c.ref, c]));
  const errors = []; const warnings = [];
  const counts = { verified: { posts: 0, ads: 0, blocks: 0, items: 0 } };

  // The source text a raw_ref points at: the exact record, the exact Exa result, or the whole call.
  const source = (ref, label) => {
    const [rawFile, frag] = String(ref).split('#');
    const file = rawFile.startsWith('raw/calls/') ? rawFile.slice(4) : rawFile; // collectors cite saved calls as raw/calls/<file> or calls/<file>
    if (file.startsWith('raw/') && !file.startsWith('raw/calls/')) {
      const path = join(dir, file);
      if (!existsSync(path)) { errors.push(`${label}: raw_ref ${ref} names a file that does not exist`); return null; }
      let text = readFileSync(path, 'utf8');
      if (file.endsWith('.json')) { try { text = `${text} ${leaves(JSON.parse(text)).join(' ')}`; } catch { /* plain text */ } }
      return { corpus: norm(text), file: true };
    }
    const call = calls.get(file);
    if (!call) { errors.push(`${label}: raw_ref ${ref} names a captured call that does not exist`); return null; }
    if (!frag) return { corpus: corpusOf(call) };
    if (frag.startsWith('exa:')) {
      const b = parseExaResults(call.text)[Number(frag.slice(4))];
      if (!b) { errors.push(`${label}: raw_ref ${ref} points past the end of the Exa results`); return null; }
      return { corpus: norm(b.raw) };
    }
    const ptr = frag.startsWith('/') ? frag : `/${frag}`;
    const rec = pointer(call.json, ptr);
    if (rec === undefined) { errors.push(`${label}: raw_ref ${ref} points at nothing in the saved response`); return null; }
    return { corpus: norm(leaves(rec).join(' ')) };
  };

  for (const p of ev.posts ?? []) {
    if (!p.raw_ref) continue;
    const label = `post ${p.id ?? p.url}`; const s = source(p.raw_ref, label);
    if (!s || s.corpus == null) continue;
    const bad = [];
    for (const line of String(p.text ?? '').split('\n').map(norm).filter(Boolean)) if (!s.corpus.includes(line)) bad.push(`text "${line.slice(0, 50)}"`);
    const nums = numsIn(s.corpus);
    for (const [k, v] of Object.entries(p.metrics ?? {})) if (!nums.has(v)) bad.push(`${k}=${v}`);
    if (bad.length) errors.push(`${label}: not found in ${p.raw_ref}: ${bad.join(', ')}`); else counts.verified.posts++;
  }
  for (const a of ev.ads ?? []) {
    if (!a.raw_ref) continue;
    const label = `ad ${a.id}`; const s = source(a.raw_ref, label);
    if (!s || s.corpus == null) continue;
    if (!a.days_shown_basis && !numsIn(s.corpus).has(a.days_shown)) errors.push(`${label}: days_shown=${a.days_shown} not found in ${a.raw_ref}`); else counts.verified.ads++;
  }
  const blockKeys = ['site', 'site_checks', 'oss', 'pricing', 'tech', 'traffic', 'content', 'earned', 'ratings', 'meta_ads'];
  for (const k of [...blockKeys, 'community']) {
    const blocks = k === 'community' ? Object.values(ev.community ?? {}) : [ev[k]];
    for (const b of blocks) if (b?.raw_ref && source(b.raw_ref, k)) counts.verified.blocks++;
  }
  for (const a of ev.accounts ?? []) if (a.raw_ref) source(a.raw_ref, `account ${a.handle}`);
  for (const it of ev.items ?? []) {
    if (it.raw_ref && source(it.raw_ref, it.id)) counts.verified.items++;
    if (!Array.isArray(it.cites) || !it.cites.length) continue;
    const corpus = [];
    for (const c of it.cites) { const s = source(c, `${it.id} cites`); if (s?.corpus) corpus.push(s.corpus); else if (s) corpus.push(''); }
    const have = numsIn(corpus.join(' '));
    const missing = [...dataNumsIn(it.finding)].filter((n) => n >= 10 && !have.has(n));
    if (corpus.length && missing.length) warnings.push(`${it.id}: the finding mentions ${missing.join(', ')}, which does not appear in ${it.cites.join(', ')}`);
  }
  return { errors, warnings, counts };
}
