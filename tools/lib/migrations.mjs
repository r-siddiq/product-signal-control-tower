import { createHash } from 'node:crypto';

export const MIGRATION_FILES = Object.freeze([
  '001_extensions.sql',
  '002_schema.sql',
  '003_seed_taxonomy.sql',
  '004_lean_single_review.sql',
]);

export function parseMigrationOptions(args) {
  const result = { dryRun: false, projectName: 'product-signal-control-tower', envFile: null, composeFile: null };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (seen.has(flag)) throw new Error('Duplicate option');
    seen.add(flag);
    if (flag === '--dry-run') {
      result.dryRun = true;
    } else if (flag === '--project-name' || flag === '--env-file' || flag === '--compose-file') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error('Missing option value');
      if (flag === '--project-name') result.projectName = value;
      else if (flag === '--env-file') result.envFile = value;
      else result.composeFile = value;
    } else {
      throw new Error('Unknown option');
    }
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(result.projectName)) {
    throw new Error('Project name must use lowercase letters, digits, underscores or hyphens');
  }
  return result;
}

function canonicalSource(value, filename) {
  if (typeof value !== 'string') throw new TypeError(`Migration ${filename} must be text`);
  const normalized = value.replace(/\r\n?/g, '\n');
  if (!/^\s*BEGIN\s*;/i.test(normalized) || !/COMMIT\s*;\s*$/i.test(normalized)) {
    throw new Error(`Migration ${filename} must have one outer BEGIN/COMMIT pair`);
  }
  const body = normalized.replace(/^\s*BEGIN\s*;\s*/i, '').replace(/\s*COMMIT\s*;\s*$/i, '');
  if (/^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/im.test(body)) {
    throw new Error(`Migration ${filename} contains nested transaction control`);
  }
  if (/^\s*\\[A-Za-z]/m.test(body)) {
    throw new Error(`Migration ${filename} contains a psql command`);
  }
  return { normalized, body };
}

export function buildMigrationBatch(migrations) {
  if (!Array.isArray(migrations) || migrations.length !== MIGRATION_FILES.length) {
    throw new Error('All four migrations are required');
  }
  const blocks = [
    '\\set ON_ERROR_STOP on',
    'BEGIN;',
    'SELECT pg_advisory_xact_lock(724398112341);',
    `DO $portfolio_guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace n
    WHERE n.nspname NOT IN ('public', 'pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg_toast%'
      AND n.nspname NOT LIKE 'pg_temp_%'
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
                      WHERE d.classid = 'pg_catalog.pg_class'::regclass
                        AND d.objid = c.oid AND d.deptype = 'e')
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
                      WHERE d.classid = 'pg_catalog.pg_proc'::regclass
                        AND d.objid = p.oid AND d.deptype = 'e')
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_type t
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typelem = 0 AND t.typtype IN ('b', 'e', 'd', 'c', 'r', 'm')
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
                      WHERE d.classid = 'pg_catalog.pg_type'::regclass
                        AND d.objid = t.oid AND d.deptype = 'e')
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_operator o
    JOIN pg_catalog.pg_namespace n ON n.oid = o.oprnamespace
    WHERE n.nspname = 'public'
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
                      WHERE d.classid = 'pg_catalog.pg_operator'::regclass
                        AND d.objid = o.oid AND d.deptype = 'e')
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_collation c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.collnamespace
    WHERE n.nspname = 'public'
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
                      WHERE d.classid = 'pg_catalog.pg_collation'::regclass
                        AND d.objid = c.oid AND d.deptype = 'e')
  ) THEN
    RAISE EXCEPTION 'Refusing migrations against detected pre-existing application objects';
  END IF;
END
$portfolio_guard$;`,
    `CREATE TABLE public.portfolio_schema_migrations (
  filename text PRIMARY KEY,
  sha256 text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);`,
  ];
  migrations.forEach(({ name, sql }, index) => {
    if (name !== MIGRATION_FILES[index]) throw new Error('Migrations must be supplied once in filename order');
    const { normalized, body } = canonicalSource(sql, name);
    const digest = createHash('sha256').update(normalized, 'utf8').digest('hex');
    blocks.push(body);
    blocks.push(`INSERT INTO public.portfolio_schema_migrations (filename, sha256) VALUES ('${name}', '${digest}');`);
  });
  blocks.push('COMMIT;');
  return `${blocks.join('\n\n')}\n`;
}
