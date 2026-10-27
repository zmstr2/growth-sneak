#!/usr/bin/env node
// Save every Firecrawl and Exa tool response to disk exactly as the tool returned it.
//
// Registered as a PostToolUse hook (hooks/hooks.json). Claude Code runs it after each MCP call, including calls made
// inside subagents, and passes the call as JSON on stdin. No model is involved, so what lands in
// reports/<domain>/raw/calls/ is the provider's own answer, never a retelling of it.
//
//   node scripts/capture.mjs --start <reports/domain>   mark a run as active (the /sneak skill does this)
//   node scripts/capture.mjs --stop                     clear the marker
//   (stdin JSON)                                        hook mode: write one call file
//
// The hook never blocks or changes a tool call: it prints nothing and always exits 0.

import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { isMain } from './ismain.mjs';

const MAX_AGE_MS = 12 * 3600 * 1000;
const markerPath = (base) => join(base, 'reports', '.active-run');

export function startRun(runDir, base = process.cwd()) {
  const dir = resolve(base, runDir);
  mkdirSync(join(dir, 'raw', 'calls'), { recursive: true });
  mkdirSync(join(base, 'reports'), { recursive: true });
  writeFileSync(markerPath(base), `${JSON.stringify({ dir, started_at: new Date().toISOString() })}\n`);
  return dir;
}
export function stopRun(base = process.cwd()) { rmSync(markerPath(base), { force: true }); }

// Which run is active for a hook fired from `cwd`? Looks in cwd, then CLAUDE_PROJECT_DIR.
export function activeRun(cwds) {
  for (const base of cwds.filter(Boolean)) {
    const p = markerPath(base);
    if (!existsSync(p)) continue;
    try {
      if (Date.now() - statSync(p).mtimeMs > MAX_AGE_MS) continue;
      const { dir } = JSON.parse(readFileSync(p, 'utf8'));
      if (dir && isAbsolute(dir)) return dir;
    } catch { /* unreadable marker: not in a run */ }
  }
  return null;
}

export function capture(input, runDir) {
  const at = new Date().toISOString();
  const short = String(input.tool_name ?? 'tool').split('__').pop().replace(/[^A-Za-z0-9_-]/g, '');
  const id = createHash('sha1').update(String(input.tool_use_id ?? Math.random())).digest('hex').slice(0, 8);
  const file = `${at.replace(/[:.]/g, '-')}-${id}-${short}.json`;
  const dir = join(runDir, 'raw', 'calls');
  mkdirSync(dir, { recursive: true });
  const record = {
    tool: input.tool_name, mcp_server: input.mcp_server ?? null, at,
    agent_type: input.agent_type ?? null, agent_id: input.agent_id ?? null, tool_use_id: input.tool_use_id ?? null,
    tool_input: input.tool_input ?? {}, response: input.tool_response ?? null,
  };
  writeFileSync(join(dir, file), `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
  return file;
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

if (isMain(import.meta.url)) {
  const [flag, arg] = process.argv.slice(2);
  try {
    if (flag === '--start') { console.log(startRun(arg)); }
    else if (flag === '--stop') { stopRun(); }
    else {
      const input = JSON.parse(await readStdin());
      const run = activeRun([input.cwd, process.env.CLAUDE_PROJECT_DIR, process.cwd()]);
      if (run) capture(input, run);
    }
  } catch (e) { if (flag) { console.error(`error: ${e.message}`); process.exit(1); } }
  process.exit(0);
}
