// Read the MCP calls captured by scripts/capture.mjs (reports/<domain>/raw/calls/*.json) and pull plain
// data out of them. Nothing here writes or rewrites a value: it only finds where a value already is.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// An MCP tool result is a list of content blocks; the useful ones are { type: 'text', text }. Firecrawl puts a
// JSON document in that text, Exa puts plain text. Hooks may hand us the blocks, the object around them or a string.
function textOf(r) {
  if (typeof r === 'string') return r;
  if (Array.isArray(r)) return r.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
  if (r && typeof r === 'object') {
    if (Array.isArray(r.content)) return textOf(r.content);
    if (typeof r.text === 'string') return r.text;
    if (r.structuredContent != null) return JSON.stringify(r.structuredContent);
  }
  return null;
}

export function unwrap(response) {
  const text = textOf(response);
  if (text == null) return { text: JSON.stringify(response ?? null), json: response ?? null };
  try { return { text, json: JSON.parse(text) }; } catch { return { text, json: undefined }; }
}

export function loadCalls(dir) {
  const cdir = join(dir, 'raw', 'calls');
  if (!existsSync(cdir)) return [];
  const calls = [];
  for (const file of readdirSync(cdir).filter((f) => f.endsWith('.json')).sort()) {
    let rec;
    try { rec = JSON.parse(readFileSync(join(cdir, file), 'utf8')); } catch { continue; }
    const { text, json } = unwrap(rec.response);
    calls.push({
      file, ref: `calls/${file}`, tool: String(rec.tool ?? ''), short: String(rec.tool ?? '').split('__').pop(),
      args: rec.tool_input ?? {}, at: rec.at ?? '', agent_type: rec.agent_type ?? null, text, json,
    });
  }
  return calls.sort((a, b) => String(a.at).localeCompare(String(b.at)) || a.file.localeCompare(b.file));
}

// JSON pointer ("/data/alexandria/0/records/3") into parsed JSON.
export function pointer(json, ptr) {
  if (!ptr) return json;
  let cur = json;
  for (const part of String(ptr).split('/').slice(1)) {
    if (cur == null) return undefined;
    cur = cur[part.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return cur;
}

const key = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
// Read a field whatever its case or snake/camel spelling. Returns the first name that is present.
export function field(rec, ...names) {
  if (!rec || typeof rec !== 'object') return undefined;
  const have = new Map(Object.keys(rec).map((k) => [key(k), k]));
  for (const n of names) { const k = have.get(key(n)); if (k !== undefined && rec[k] != null) return rec[k]; }
  return undefined;
}

const PREFERRED = ['records', 'posts', 'tweets', 'ads', 'creatives', 'items', 'results', 'data'];
// The list of records inside a result, with the JSON pointer to it (relative to `obj`).
export function findRecords(obj, base = '', depth = 0) {
  if (Array.isArray(obj)) return obj.length === 0 || typeof obj[0] === 'object' ? { records: obj, ptr: base } : null;
  if (!obj || typeof obj !== 'object' || depth > 3) return null;
  for (const k of PREFERRED) {
    if (obj[k] != null) { const f = findRecords(obj[k], `${base}/${k}`, depth + 1); if (f) return f; }
  }
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v) && v.length && typeof v[0] === 'object') return { records: v, ptr: `${base}/${k}` };
  }
  return null;
}

// The Alexandria calls made through firecrawl_scrape: [{ provider, capability, options, result, ptr, call }].
export function alexandria(call) {
  if (!/firecrawl_scrape$/.test(call.tool) || !call.args?.alexandria) return [];
  const reqs = Array.isArray(call.args.alexandria) ? call.args.alexandria : [call.args.alexandria];
  const root = call.json?.data?.alexandria !== undefined ? ['/data/alexandria', call.json.data.alexandria]
    : call.json?.alexandria !== undefined ? ['/alexandria', call.json.alexandria] : [null, null];
  const [base, res] = root;
  if (res == null) return [];
  const list = Array.isArray(res) ? res : Object.values(res);
  const paths = Array.isArray(res) ? list.map((_, i) => `${base}/${i}`) : Object.keys(res).map((k) => `${base}/${k}`);
  return reqs.map((r, i) => {
    let idx = list.findIndex((x, j) => j >= 0 && x && x.provider === r.provider && x.capability === r.capability);
    if (idx < 0) idx = i;
    return { provider: r.provider, capability: r.capability, options: r.options ?? {}, result: list[idx], ptr: paths[idx], call };
  }).filter((x) => x.result != null);
}

export const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
export const isoDay = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') { const d = new Date(v < 1e12 ? v * 1000 : v); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10); }
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v));
  if (m) return m[1];
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};
export const num = (v) => { if (typeof v === 'number') return Number.isFinite(v) ? v : undefined; if (typeof v === 'string' && /^-?\d[\d,]*(\.\d+)?$/.test(v.trim())) return Number(v.replace(/,/g, '')); return undefined; };

// Every string and number leaf in a value, as one searchable text (for provenance checks).
export function corpusOf(call) {
  const parts = [call.text ?? ''];
  const walk = (v) => { if (v == null) return; if (typeof v === 'string') parts.push(v); else if (typeof v === 'number') parts.push(String(v)); else if (typeof v === 'object') for (const x of Object.values(v)) walk(x); };
  walk(call.json);
  return norm(parts.join(' '));
}
