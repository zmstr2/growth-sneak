import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, symlinkSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('scripts run from a symlinked path (macOS /tmp, a linked plugin folder), not silently do nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gs-link-'));
  try {
    const link = join(dir, 'plugin');
    symlinkSync(ROOT, link);
    const sample = join(dir, 'sample');
    cpSync(join(ROOT, 'tests', 'fixtures', 'notion.com'), sample, { recursive: true });
    const out = execFileSync('node', [join(link, 'scripts', 'render.mjs'), sample], { encoding: 'utf8' });
    assert.match(out, /wrote .*report\.html/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
