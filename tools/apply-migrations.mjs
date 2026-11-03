import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildMigrationBatch, MIGRATION_FILES, parseMigrationOptions } from './lib/migrations.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let options;
try {
  options = parseMigrationOptions(process.argv.slice(2));
} catch (error) {
  console.error(`Invalid migration options: ${error.message}`);
  console.error('Usage: node tools/apply-migrations.mjs [--dry-run] [--project-name NAME] [--env-file PATH] [--compose-file PATH]');
  process.exit(2);
}
let batch;
try {
  const migrations = MIGRATION_FILES.map((name) => ({
    name,
    sql: readFileSync(join(root, 'database', name), 'utf8'),
  }));
  batch = buildMigrationBatch(migrations);
} catch (error) {
  console.error(`Migration input is invalid: ${error.message}`);
  process.exit(1);
}
if (options.dryRun) {
  console.log(`Migration batch prepared in order: ${MIGRATION_FILES.join(', ')}`);
  console.log('Dry run only; Docker and PostgreSQL were not contacted.');
  process.exit(0);
}
const envFile = options.envFile ? resolve(root, options.envFile) : join(root, 'runtime', '.env');
const composeFile = options.composeFile ? resolve(root, options.composeFile) : join(root, 'runtime', 'compose.yaml');
if (!existsSync(envFile)) {
  console.error('Missing runtime/.env; initialize the local runtime before applying migrations.');
  process.exit(1);
}
const result = spawnSync('docker', [
  'compose', '--project-name', options.projectName,
  '--env-file', envFile, '-f', composeFile,
  'exec', '-T', 'postgres',
  'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'signal_demo',
], { cwd: root, input: batch, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 120000 });
if (result.error || result.status !== 0) {
  console.error('Migration failed or its result is uncertain. Check Docker and the migration ledger before retrying.');
  console.error('Database output is withheld to avoid exposing local data.');
  process.exit(1);
}
console.log('Database migrations applied to the isolated demo database.');
