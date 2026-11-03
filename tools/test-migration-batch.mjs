import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMigrationBatch, MIGRATION_FILES, parseMigrationOptions } from './lib/migrations.mjs';

assert.deepEqual(parseMigrationOptions([]), { dryRun: false, projectName: 'product-signal-control-tower', envFile: null, composeFile: null });
assert.deepEqual(parseMigrationOptions(['--dry-run', '--project-name', 'isolated-check', '--env-file', 'example.env', '--compose-file', 'compose.yaml']), { dryRun: true, projectName: 'isolated-check', envFile: 'example.env', composeFile: 'compose.yaml' });
assert.throws(() => parseMigrationOptions(['--project-name', 'INVALID!']), /Project name/);
assert.throws(() => parseMigrationOptions(['--project-name']), /Missing option value/);
assert.throws(() => parseMigrationOptions(['--dry-run', '--dry-run']), /Duplicate option/);
assert.throws(() => parseMigrationOptions(['--unknown']), /Unknown option/);

const fixtures = MIGRATION_FILES.map((name, index) => ({
  name,
  sql: `BEGIN;\nSELECT ${index + 1};\nCOMMIT;\n`,
}));
const batch = buildMigrationBatch(fixtures);
assert.ok(batch.startsWith('\\set ON_ERROR_STOP on\n\nBEGIN;'));
assert.ok(batch.endsWith('COMMIT;\n'));
assert.match(batch, /pg_advisory_xact_lock/);
assert.match(batch, /detected pre-existing application objects/);
assert.match(batch, /pg_catalog\.pg_operator/);
assert.match(batch, /pg_catalog\.pg_collation/);
assert.equal((batch.match(/^INSERT INTO public\.portfolio_schema_migrations/gm) ?? []).length, 4);
assert.equal((batch.match(/^COMMIT;$/gm) ?? []).length, 1);
const offsets = fixtures.map((entry, index) => batch.indexOf(`SELECT ${index + 1};`));
assert.ok(offsets.every((offset, index) => offset >= 0 && (index === 0 || offset > offsets[index - 1])));
const crlfFixtures = fixtures.map((entry) => ({ ...entry, sql: entry.sql.replace(/\n/g, '\r\n') }));
assert.equal(buildMigrationBatch(crlfFixtures), batch);
assert.throws(() => buildMigrationBatch(fixtures.slice(1)), /four migrations/);
assert.throws(() => buildMigrationBatch([...fixtures].reverse()), /filename order/);
assert.throws(() => buildMigrationBatch([{ ...fixtures[0], sql: 'SELECT 1;' }, ...fixtures.slice(1)]), /outer BEGIN\/COMMIT/);
assert.throws(() => buildMigrationBatch([{ ...fixtures[0], sql: 'BEGIN;\nCOMMIT;\nCOMMIT;' }, ...fixtures.slice(1)]), /nested transaction/);
assert.throws(() => buildMigrationBatch([{ ...fixtures[0], sql: 'BEGIN;\n\\include other.sql\nCOMMIT;' }, ...fixtures.slice(1)]), /psql command/);
const actual = MIGRATION_FILES.map((name) => ({ name, sql: readFileSync(new URL(`../database/${name}`, import.meta.url), 'utf8') }));
assert.ok(buildMigrationBatch(actual).includes('portfolio_schema_migrations'));
console.log('Migration batch checks passed for four ordered migrations.');
