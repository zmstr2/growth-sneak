// True when the file is being run directly (`node scripts/x.mjs`), also when the path goes through a symlink
// (macOS /tmp, a linked plugin folder): both sides are resolved to real paths before comparing.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function isMain(metaUrl) {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(metaUrl)); } catch { return false; }
}
