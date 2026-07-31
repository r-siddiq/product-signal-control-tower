import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, '..', '.env');

if (existsSync(envPath)) {
  process.stdout.write('Root .env already exists; no values were changed.\n');
  process.exit(0);
}

const password = randomBytes(32).toString('hex');
const content = [
  'SIGNAL_REVIEW_USER=signal-reviewer',
  `SIGNAL_REVIEW_PASSWORD=${password}`,
  '',
].join('\n');

writeFileSync(envPath, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
process.stdout.write('Created ignored .env with fresh local reviewer credentials.\n');
