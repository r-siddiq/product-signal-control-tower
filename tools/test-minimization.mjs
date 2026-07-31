import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const projectDir = join(here, '..');
const source = readFileSync(join(projectDir, 'workflows', 'code', 'validate-normalize-minimize.js'), 'utf8');
const fixtures = JSON.parse(readFileSync(join(projectDir, 'fixtures', 'synthetic-signals.json'), 'utf8'));
const golden = JSON.parse(readFileSync(join(projectDir, 'fixtures', 'golden-expectations.json'), 'utf8'));
const expectedById = new Map(golden.cases.map((entry) => [entry.case_id, entry.exact_deterministic_expectations]));

const runCodeNode = new Function('$input', '$execution', source);
const failures = [];
const results = [];

for (let index = 0; index < fixtures.cases.length; index += 1) {
  const fixture = fixtures.cases[index];
  const expected = expectedById.get(fixture.demo_case_id);
  const outputItems = runCodeNode(
    { all: () => [{ json: structuredClone(fixture) }] },
    { id: String(1000 + index) },
  );
  const output = outputItems[0].json;
  const emailRedactions = (output.minimized_text.match(/\[REDACTED_EMAIL\]/g) ?? []).length;
  const phoneRedactions = (output.minimized_text.match(/\[REDACTED_PHONE\]/g) ?? []).length;

  const checks = {
    validation_ok: output.validation_ok === expected.validation_ok,
    normalized_source_key: `${output.source_system}|${output.source_event_id}` === expected.normalized_source_key,
    email_redactions: emailRedactions === expected.email_redactions,
    phone_redactions: phoneRedactions === expected.phone_redactions,
    contact_field_removed: output.sensitivity_flags.contact_field_removed === expected.contact_field_removed,
    simulate_provider_failure: output.simulate_provider_failure === expected.simulate_provider_failure,
    no_raw_text_field: !Object.hasOwn(output, 'raw_text'),
    no_synthetic_contact_field: !Object.hasOwn(output, 'synthetic_contact'),
  };

  const failedChecks = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  if (failedChecks.length > 0) failures.push({ case_id: fixture.demo_case_id, failed_checks: failedChecks });
  results.push({ case_id: fixture.demo_case_id, passed: failedChecks.length === 0 });
}

if (failures.length > 0) {
  process.stderr.write(`${JSON.stringify({ valid: false, failures }, null, 2)}\n`);
  process.exitCode = 1;
} else {
  const formOutput = runCodeNode(
    {
      all: () => [{
        json: {
          'Source context': 'Product feedback',
          'Product area, if known': 'Signal Agent',
          'Product signal or feedback':
            'A synthetic staff member wants the answer to expose the date of its approved source.',
        },
      }],
    },
    { id: '4242' },
  )[0].json;

  if (
    formOutput.source_event_id !== 'FORM-4242'
    || formOutput.correlation_id !== 'exec_4242'
    || formOutput.validation_ok !== true
  ) {
    throw new Error('Three-field form intake did not generate valid execution metadata.');
  }

  process.stdout.write(`${JSON.stringify({
    valid: true,
    cases: results.length,
    passed: results.filter((entry) => entry.passed).length,
    visible_form_fields: 3,
    execution_metadata_generated: true,
    raw_text_persisted: false,
    synthetic_contact_persisted: false,
  }, null, 2)}\n`);
}
