#!/usr/bin/env node
// First-run setup: find out whether the Firecrawl and Exa API keys are available, save them, check they work.
//
//   node scripts/setup.mjs check              which keys are set, and where (never prints a key)
//   echo '{"FIRECRAWL_API_KEY":"fc-...","EXA_API_KEY":"..."}' | node scripts/setup.mjs save
//   node scripts/setup.mjs verify             one cheap call per key to see that it is accepted
//
// Keys live in the `env` block of the user's Claude Code settings file (~/.claude/settings.json), which is
// where the plugin's .mcp.json reads FIRECRAWL_API_KEY and EXA_API_KEY from. An exported shell variable works
// too and wins over the file. Keys are never written into the plugin, a report or a log, and never printed:
// only the last four characters are shown, so the user can tell which key was saved.

import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { isMain } from './ismain.mjs';

export const PROVIDERS = {
  firecrawl: {
    name: 'Firecrawl', envVar: 'FIRECRAWL_API_KEY', keyUrl: 'https://www.firecrawl.dev/app/api-keys',
    note: 'Sign up (free credits to start), open API Keys and copy the key that starts with fc-.',
    valid: (k) => /^fc-[A-Za-z0-9_-]{16,}$/.test(k),
    shape: 'starts with fc- followed by letters and numbers',
  },
  exa: {
    name: 'Exa', envVar: 'EXA_API_KEY', keyUrl: 'https://dashboard.exa.ai/api-keys',
    note: 'Sign up (new accounts start with free credits), open API Keys and create a key.',
    valid: (k) => /^[A-Za-z0-9_-]{20,}$/.test(k),
    shape: 'a single string of letters, numbers and dashes',
  },
};

export const settingsPath = (env = process.env) => join(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'settings.json');

function readSettings(path) {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, 'utf8');
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed;
  } catch (e) {
    // Never overwrite a settings file we cannot read: it holds the user's other settings.
    throw new Error(`${path} is not valid JSON (${e.message}). Fix it or remove it, then run setup again.`);
  }
}

export const mask = (k) => `…${String(k).slice(-4)}`;

// Where each key is available: the process environment first, then the settings file's env block.
export function check({ env = process.env, path = settingsPath(env) } = {}) {
  let fromFile = {};
  let fileError = null;
  try { fromFile = readSettings(path).env ?? {}; } catch (e) { fileError = e.message; }
  const out = {};
  for (const [id, p] of Object.entries(PROVIDERS)) {
    const inEnv = Boolean(env[p.envVar]);
    const inFile = Boolean(fromFile[p.envVar]);
    out[id] = { name: p.name, set: inEnv || inFile, source: inEnv ? 'environment' : inFile ? 'settings file' : null, key_url: p.keyUrl };
  }
  return { ...out, settings_path: path, ...(fileError ? { settings_error: fileError } : {}) };
}

// Save keys into the settings file's env block, keeping everything else. Returns what was saved, masked.
export function save(keys, { env = process.env, path = settingsPath(env) } = {}) {
  const saved = {};
  const updates = {};
  for (const [id, p] of Object.entries(PROVIDERS)) {
    const raw = keys?.[p.envVar];
    if (raw == null || raw === '') continue;
    const k = String(raw).trim();
    if (!p.valid(k)) throw new Error(`The ${p.name} key does not look right (it should be ${p.shape}). Nothing was saved.`);
    updates[p.envVar] = k;
    saved[id] = mask(k);
  }
  if (!Object.keys(updates).length) throw new Error('No keys were given. Nothing was saved.');
  const settings = readSettings(path);
  settings.env = { ...(settings.env && typeof settings.env === 'object' ? settings.env : {}), ...updates };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  try { chmodSync(path, 0o600); } catch { /* best effort on systems without chmod */ }
  return { saved, path };
}

const keyFor = (id, { env, path }) => {
  const p = PROVIDERS[id];
  if (env[p.envVar]) return env[p.envVar];
  try { return readSettings(path).env?.[p.envVar] ?? null; } catch { return null; }
};

// One cheap request per key. 401 and 403 mean the key was refused; anything else that goes wrong is "could not
// verify", which is not the same as a bad key.
export async function verify({ env = process.env, path = settingsPath(env), fetchImpl = fetch } = {}) {
  const out = {};
  const call = async (url, init) => {
    try { return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(15_000) }); } catch { return null; }
  };
  const judge = (res) => (!res ? 'unverified' : res.status === 401 || res.status === 403 ? 'rejected' : res.ok ? 'ok' : 'unverified');
  const fc = keyFor('firecrawl', { env, path });
  if (!fc) out.firecrawl = 'missing';
  else {
    let res = await call('https://api.firecrawl.dev/v2/team/credit-usage', { headers: { authorization: `Bearer ${fc}` } });
    if (!res || res.status === 404) res = await call('https://api.firecrawl.dev/v1/team/credit-usage', { headers: { authorization: `Bearer ${fc}` } });
    out.firecrawl = judge(res);
  }
  const ex = keyFor('exa', { env, path });
  if (!ex) out.exa = 'missing';
  else {
    const res = await call('https://api.exa.ai/search', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': ex }, body: JSON.stringify({ query: 'growth sneak key check', numResults: 1 }) });
    out.exa = judge(res);
  }
  return out;
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'check') { console.log(JSON.stringify(check(), null, 2)); return; }
  if (cmd === 'save') {
    let keys;
    try { keys = JSON.parse(await readStdin()); } catch { console.error('error: send the keys as JSON on stdin, for example {"FIRECRAWL_API_KEY":"fc-..."}'); process.exit(2); }
    const r = save(keys);
    console.log(`Saved ${Object.entries(r.saved).map(([id, m]) => `${PROVIDERS[id].name} key (${m})`).join(' and ')} to ${r.path}.`);
    console.log('Restart Claude Code (or reload plugins) so the connections pick the keys up, then run /sneak again.');
    return;
  }
  if (cmd === 'verify') { console.log(JSON.stringify(await verify(), null, 2)); return; }
  console.error('usage: node scripts/setup.mjs check | save | verify');
  process.exit(2);
}

if (isMain(import.meta.url)) {
  main().catch((e) => { console.error(`error: ${String(e.message).replace(/\bfc-[A-Za-z0-9_-]+/g, 'fc-***')}`); process.exit(1); });
}
